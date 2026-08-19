import { Router } from 'express';
import { authRequired } from '../middleware.js';
import { runAI } from '../ai-service.js';
import { formatReference } from '../ai.js';
import { logUsage } from '../usage.js';
import logger from '../logger.js';
import { getFeaturePrice } from '../config-store.js';
import { isFreeUnlimitedFeature, getPointsBalance, consumePoints, refundPoints, estimatePointsForCall, estimateCallTokens, tokensToPoints, estimateEffectivePoints, getFeatureFixedPoints } from '../services/billing.js';
import { generateDocx } from '../services/docx-generator.js';
import { saveTask, buildProjectContext, isProjectOwned } from '../services/task-store.js';
import db from '../db.js';

const router = Router();

// 输入文本长度上限（防超大文本拖垮 AI 调用与数据库写入）
const MAX_INPUT_CHARS = 50000;
const MAX_TOPIC_CHARS = 500;

// 校验文本长度，返回错误信息或 null
function checkTextLen(text, max, label = '文本') {
  if (text && text.length > max) {
    return `${label}过长（最多 ${max} 字符，当前 ${text.length}）`;
  }
  return null;
}

// 工具调用前置：按大模型 token 用量预估积分，决定是直接执行（免费/积分充足）还是需要充值
// 返回 { mode: 'unlimited' | 'points' | 'need_points', points?, balance?, needed? }
function resolveBilling(userId, featureKey, toolType, params) {
  // 免费且不限次的功能（如大纲生成、文献检索），直接放行
  if (isFreeUnlimitedFeature(featureKey)) {
    return { ok: true, mode: 'unlimited' };
  }
  // 有效积分 = max(管理员固定定价, 按 token 动态估算)，保证不亏本
  const points = estimateEffectivePoints(featureKey, toolType, params);
  const balance = getPointsBalance(userId);
  if (balance >= points) {
    return { ok: true, mode: 'points', points, balance };
  }
  return { ok: true, mode: 'need_points', balance, needed: points };
}

// 通用：执行 AI 调用 + 失败时退款/取消订单
// projectId: 可选，关联论文工作区，用于注入上下文
// inputText: 可选，保存到任务记录的输入摘要文本
// generateDocxOptions: 写作类/开题报告等需要输出 Word 时传入
// generatePptxOptions: 答辩等需要输出 .pptx 时传入（与 generateDocxOptions 互斥）
// transformContent: 可选，对 AI 输出做后处理（如引用/图表占位符替换），在 docx/pptx 生成前执行
async function executeWithBilling({ userId, featureKey, toolType, action, params, generateDocxOptions = null, generatePptxOptions = null, projectId = null, inputText = '', transformContent = null }) {
  // 安全：校验工作区归属（防跨用户上下文注入），非本人工作区直接拒绝
  if (projectId && !isProjectOwned(userId, projectId)) {
    throw new Error('无权访问该工作区');
  }

  // 注入工作区上下文（如果有 projectId）—— 先注入，让 token 预估包含上下文用量
  let contextSummary = '';
  if (projectId) {
    const ctx = buildProjectContext(projectId, userId, { currentToolType: toolType, currentAction: action });
    if (ctx.context) {
      params = { ...params, context: ctx.context };
      contextSummary = ctx.summary;
    }
  }

  const bill = resolveBilling(userId, featureKey, toolType, params);
  if (!bill.ok) throw new Error(bill.error);

  let chargeType = 'none';
  let amount = 0;
  let deductedPoints = 0;
  let estimatedTokens = null;
  let order = null; // 积分制不再创建按次订单，保留变量供日志关联

  if (bill.mode === 'unlimited') {
    // 免费且不限次（如大纲生成），不消耗积分
    chargeType = 'unlimited';
  } else if (bill.mode === 'points') {
    // 积分充足，按预估 token 用量扣减
    try {
      consumePoints(userId, bill.points, `${featureKey}：${action}（按大模型用量计费）`);
      deductedPoints = bill.points;
      chargeType = 'points';
      estimatedTokens = estimateCallTokens(toolType, params);
    } catch (err) {
      return {
        needPoints: true,
        balance: getPointsBalance(userId),
        needed: bill.points,
        message: err.message,
      };
    }
  } else {
    // 积分不足，提示充值
    return {
      needPoints: true,
      balance: bill.balance || 0,
      needed: bill.needed,
    };
  }

  // 执行 AI
  let aiResult;
  try {
    aiResult = await runAI(toolType, params);
  } catch (err) {
    // 失败退款
    if (deductedPoints > 0) {
      refundPoints(userId, deductedPoints, `AI 调用失败退款：${featureKey}`);
    }
    // 记录失败日志
    try {
      logUsage({
        userId,
        toolType,
        action,
        model: { name: 'unknown' },
        inputChars: JSON.stringify(params).length,
        outputChars: 0,
        tokens: 0,
        status: 'failed',
        orderId: order?.id,
        chargeType,
        amount,
        message: err.message,
      });
    } catch {}
    throw err;
  }

  // 后处理：在 docx/pptx 生成前，对 AI 输出做占位符替换（引用编号 + 数据图表由代码生成）
  if (typeof transformContent === 'function') {
    aiResult.content = await transformContent(aiResult.content, aiResult);
  }

  // 计费结算：按真实 token 用量多退少补（仅真实 AI 且本次预扣了积分）
  // 最终应扣 = max(固定定价, 真实用量动态积分)，与预扣的差额多退少补
  let settledPoints = deductedPoints;
  if (deductedPoints > 0 && aiResult.promptTokens != null && aiResult.tokens > 0) {
    const actualCompletionTokens = aiResult.completionTokens || Math.max(0, aiResult.tokens - aiResult.promptTokens);
    const actualDynamic = tokensToPoints(aiResult.promptTokens, actualCompletionTokens);
    const finalPoints = Math.max(getFeatureFixedPoints(featureKey), actualDynamic);
    const diff = finalPoints - deductedPoints;
    if (diff > 0) {
      // 实际用量超出预估，补扣差额；余额不足不阻断已成功的调用，仅记录日志
      try {
        consumePoints(userId, diff, `${featureKey}：用量结算补扣`);
        settledPoints = finalPoints;
      } catch (err) {
        logger.error('tools', `结算补扣失败（忽略）: ${err.message}`);
      }
    } else if (diff < 0) {
      // 预估偏高，退还差额
      refundPoints(userId, -diff, `${featureKey}：用量结算退款`);
      settledPoints = finalPoints;
    } else {
      settledPoints = finalPoints;
    }
  }

  // 生成 Word（仅写作类 / 开题报告）
  let docxInfo = null;
  if (generateDocxOptions) {
    try {
      docxInfo = await generateDocx({
        ...generateDocxOptions,
        userId,
        feature: featureKey,
        orderId: order?.id || null,
        content: aiResult.content,
      });
    } catch (err) {
      // Word 生成失败不阻断主流程，记录日志
      logger.error('tools', `docx 生成失败: ${err.message}`);
    }
  }

  // 生成 PPT（答辩）：解析 AI 大纲为幻灯片后生成 .pptx
  if (generatePptxOptions) {
    try {
      const { generatePptx, parseOutlineToSlides } = await import('../services/pptx-generator.js');
      const slides = parseOutlineToSlides(aiResult.content);
      docxInfo = await generatePptx({
        ...generatePptxOptions,
        slides,
        userId,
        feature: featureKey,
        orderId: order?.id || null,
      });
    } catch (err) {
      // PPT 生成失败不阻断主流程，记录日志
      logger.error('tools', `pptx 生成失败: ${err.message}`);
    }
  }

  // 写日志
  logUsage({
    userId,
    toolType,
    action,
    model: aiResult.model,
    inputChars: JSON.stringify(params).length,
    outputChars: aiResult.content.length,
    tokens: aiResult.tokens,
    status: 'success',
    orderId: order?.id,
    chargeType,
    amount,
  });

  // 保存任务历史记录（完整输入+输出，支持回看和上下文记忆）
  let taskId = null;
  try {
    taskId = saveTask({
      userId,
      projectId: projectId || null,
      toolType,
      action,
      inputText: inputText || JSON.stringify(params).slice(0, 2000),
      outputText: aiResult.content,
      params: (() => { const p = { ...params }; delete p.context; return p; })(),
      contextSummary,
      modelName: aiResult.model?.name || '',
      tokens: aiResult.tokens,
      chargeType,
      amount,
      orderId: order?.id || null,
      status: 'success',
    });
  } catch (err) {
    logger.error('tools', `task-save failed: ${err.message}`);
  }

  return {
    content: aiResult.content,
    model: { name: aiResult.model.name, usedRealAI: aiResult.usedRealAI },
    tokens: aiResult.tokens,
    doc: docxInfo,
    chargeType,
    amount,
    orderId: order?.id || null,
    taskId,
    projectId: projectId || null,
    points: getPointsBalance(userId),
    deductedPoints: settledPoints,
    estimatedTokens,
    estimatedPoints: deductedPoints,
  };
}

// ========== AI 论文写作（输出 Word） ==========
router.post('/writing', authRequired, async (req, res) => {
  const { type, topic, field, template_id, projectId } = req.body || {};
  if (!type) return res.status(400).json({ error: '请选择写作类型' });
  if (!topic) return res.status(400).json({ error: '请填写论文题目' });
  const lenErr = checkTextLen(topic, MAX_TOPIC_CHARS, '题目');
  if (lenErr) return res.status(400).json({ error: lenErr });

  const featureKey = `writing_${type}`;
  const fp = getFeaturePrice(featureKey);
  if (!fp) return res.status(400).json({ error: '未知的写作类型' });

  // 加载模板
  let template = null;
  if (template_id) {
    template = db.prepare('SELECT * FROM templates WHERE id = ? AND (user_id = ? OR is_global = 1)').get(template_id, req.user.id);
  }

  // 全文/大纲：检索真实文献与数据，注入引用/数据硬约束（检索失败降级，不阻断主流程）
  let sourceRefs = null;
  let sourceBenchmarks = null;
  if (type === 'fulltext' || type === 'outline') {
    try {
      const { collectWritingSources } = await import('../services/paper-distillation.js');
      const { references, benchmarks } = await collectWritingSources(topic, field, '', 8);
      sourceRefs = references;
      sourceBenchmarks = benchmarks;
    } catch (err) {
      logger.warn('tools', `写作检索失败（忽略，改用无文献生成）: ${err.message}`);
    }
  }

  try {
    const result = await executeWithBilling({
      userId: req.user.id,
      featureKey,
      toolType: 'writing',
      action: type,
      params: {
        type,
        topic,
        field,
        ...(sourceRefs?.length ? { references: sourceRefs } : {}),
        ...(sourceBenchmarks?.length ? { benchmarks: sourceBenchmarks } : {}),
      },
      projectId: projectId || null,
      inputText: `【${type}】题目：${topic}${field ? ' | 学科：' + field : ''}`,
      generateDocxOptions: {
        title: topic,
        template,
      },
      transformContent: async (content) => {
        const { replaceCitePlaceholders, replaceChartPlaceholders } = await import('../services/paper-distillation.js');
        return replaceChartPlaceholders(replaceCitePlaceholders(content, sourceRefs), sourceBenchmarks);
      },
    });
    if (result.needPoints) {
      return res.json({ needPoints: true, feature: result.feature, balance: result.balance, needed: result.needed });
    }

    // 全文生成后审校：引用一致性 / 结构完整性 / 明显幻觉（仅真实 AI 下执行，免费但记录 token 成本）
    let review = null;
    if (type === 'fulltext' && result.model?.usedRealAI) {
      try {
        const reviewResult = await runAI('review', { content: result.content });
        if (reviewResult.usedRealAI && reviewResult.content) {
          review = reviewResult.content;
          // 审校是额外一次真实 AI 调用，单独记入 usage_logs（tool_type=review），便于财务核对实际 API 成本
          logUsage({
            userId: req.user.id,
            toolType: 'review',
            action: 'fulltext_review',
            model: reviewResult.model,
            inputChars: result.content.length,
            outputChars: reviewResult.content.length,
            tokens: reviewResult.tokens,
            status: 'success',
            chargeType: 'none',
            amount: 0,
          });
        }
      } catch (err) {
        logger.warn('tools', `审校失败（忽略）: ${err.message}`);
      }
    }

    res.json({
      content: result.content,
      type,
      title: topic,
      model: result.model,
      tokens: result.tokens,
      doc: result.doc,
      review,
      chargeType: result.chargeType,
      amount: result.amount,
      orderId: result.orderId,
      taskId: result.taskId,
      projectId: result.projectId,
      points: result.points,
      deductedPoints: result.deductedPoints,
    });
  } catch (err) {
    res.status(500).json({ error: '生成失败：' + err.message });
  }
});

// ========== 智能写作（检索→蒸馏→原创生成）==========
// 流程：多源检索同方向论文 → MapReduce提取框架 → 融合大纲 → 原创生成
// 计费：检索和框架提取免费，生成阶段按 writing_outline + writing_fulltext 计费
router.post('/smart-writing', authRequired, async (req, res) => {
  const { topic, field, keywords, projectId } = req.body || {};
  if (!topic) return res.status(400).json({ error: '请填写论文题目' });
  if (!field) return res.status(400).json({ error: '请选择学科领域' });
  const lenErr = checkTextLen(topic, MAX_TOPIC_CHARS, '题目');
  if (lenErr) return res.status(400).json({ error: lenErr });

  // 安全：校验工作区归属（防跨用户上下文注入）
  if (projectId && !isProjectOwned(req.user.id, projectId)) {
    return res.status(403).json({ error: '无权访问该工作区' });
  }

  // 计费：多源检索免费，但框架提取 + 大纲生成会调用大模型，按预估用量扣积分，防止白嫖
  // 使用 literature_review 的输出预算作为保守估算（框架提取 + 大纲生成的实际输出通常更低）
  // 有效积分 = max(literature_review 固定定价, 动态 token 估算)
  const billingParams = { topic, field, keywords };
  const points = estimateEffectivePoints('literature_review', 'literature_review', billingParams);
  const balance = getPointsBalance(req.user.id);
  if (balance < points) {
    return res.json({ needPoints: true, balance, needed: points });
  }

  let deductedPoints = 0;
  try {
    consumePoints(req.user.id, points, 'smart_writing：智能写作框架提取与大纲生成');
    deductedPoints = points;
  } catch (err) {
    return res.json({ needPoints: true, balance: getPointsBalance(req.user.id), needed: points });
  }

  try {
    const { smartWriting } = await import('../services/paper-distillation.js');
    const result = await smartWriting({ topic, field, keywords, projectId, userId: req.user.id });

    // 按真实 token 用量结算（多退少补），修正原先按固定输出预算预估的偏差
    let settledPoints = deductedPoints;
    const rt = result.tokens || { promptTokens: 0, completionTokens: 0 };
    if (rt.promptTokens > 0 || rt.completionTokens > 0) {
      const actualDynamic = tokensToPoints(rt.promptTokens, rt.completionTokens);
      const finalPoints = Math.max(getFeatureFixedPoints('literature_review'), actualDynamic);
      const diff = finalPoints - deductedPoints;
      if (diff > 0) {
        try {
          consumePoints(req.user.id, diff, 'smart_writing：真实用量结算补扣');
          settledPoints = finalPoints;
        } catch (e) {
          logger.error('tools', `智能写作结算补扣失败（忽略）: ${e.message}`);
        }
      } else if (diff < 0) {
        refundPoints(req.user.id, -diff, 'smart_writing：真实用量结算退款');
        settledPoints = finalPoints;
      } else {
        settledPoints = finalPoints;
      }
    }

    // 保存任务记录（检索+蒸馏+大纲，已按积分计费）
    const taskId = saveTask({
      userId: req.user.id,
      projectId: projectId || null,
      toolType: 'smart-writing',
      action: 'search-distill',
      title: `智能写作框架提取：${topic}`,
      inputText: `题目：${topic} | 学科：${field} | 关键词：${keywords || ''}`,
      outputText: JSON.stringify(result.framework, null, 2).slice(0, 5000),
      params: { topic, field, keywords, sources_used: result.framework.sources_used },
      contextSummary: `参考 ${result.framework.paperCount} 篇论文，数据源：${result.framework.sources_used?.join('、')}`,
      modelName: 'multi-source',
      tokens: 0,
      chargeType: 'points',
      amount: settledPoints,
      status: 'success',
    });

    res.json({
      ok: true,
      outline: result.outline,
      references: result.references,
      framework: result.framework,
      benchmarks: result.benchmarks,
      degraded: result.degraded,
      taskId,
      chargeType: 'points',
      deductedPoints: settledPoints,
      points: getPointsBalance(req.user.id),
      message: result.degraded
        ? `已检索 ${result.references.length} 篇相关论文（当前为模板降级模式，配置真实 AI 后框架提取与生成更精准）`
        : `已检索 ${result.references.length} 篇相关论文并提取研究框架，可基于此大纲生成分章节论文`,
    });
  } catch (err) {
    // 失败退款
    if (deductedPoints > 0) {
      refundPoints(req.user.id, deductedPoints, '智能写作失败退款');
    }
    res.status(500).json({ error: '智能写作失败：' + err.message });
  }
});

// ========== 开题报告撰写（输出 Word） ==========
router.post('/proposal', authRequired, async (req, res) => {
  const { topic, field, direction, keywords, objective, method, innovation, template_id, projectId } = req.body || {};
  if (!topic) return res.status(400).json({ error: '请填写论文题目' });
  if (!field) return res.status(400).json({ error: '请选择学科领域' });
  const lenErr = checkTextLen(topic, MAX_TOPIC_CHARS, '题目') || checkTextLen(objective, MAX_INPUT_CHARS, '研究目标') || checkTextLen(method, MAX_INPUT_CHARS, '研究方法');
  if (lenErr) return res.status(400).json({ error: lenErr });

  const featureKey = 'proposal';

  let template = null;
  if (template_id) {
    template = db.prepare('SELECT * FROM templates WHERE id = ? AND (user_id = ? OR is_global = 1)').get(template_id, req.user.id);
  }

  try {
    const result = await executeWithBilling({
      userId: req.user.id,
      featureKey,
      toolType: 'proposal',
      action: 'proposal',
      params: { topic, field, direction, keywords, objective, method, innovation },
      projectId: projectId || null,
      inputText: `【开题报告】题目：${topic} | 学科：${field}`,
      generateDocxOptions: {
        title: `${topic}开题报告`,
        template,
      },
    });
    if (result.needPoints) {
      return res.json({ needPoints: true, feature: result.feature, balance: result.balance, needed: result.needed });
    }
    res.json({
      content: result.content,
      title: `${topic}开题报告`,
      model: result.model,
      tokens: result.tokens,
      doc: result.doc,
      chargeType: result.chargeType,
      amount: result.amount,
      orderId: result.orderId,
      points: result.points,
      deductedPoints: result.deductedPoints,
    });
  } catch (err) {
    res.status(500).json({ error: '开题报告生成失败：' + err.message });
  }
});

// ========== 论文润色（纯文本） ==========
router.post('/polish', authRequired, async (req, res) => {
  const { text, projectId } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: '请输入需要润色的文本' });
  const lenErr = checkTextLen(text, MAX_INPUT_CHARS, '文本');
  if (lenErr) return res.status(400).json({ error: lenErr });

  try {
    const result = await executeWithBilling({
      userId: req.user.id,
      featureKey: 'polish',
      toolType: 'polish',
      action: 'polish',
      params: { text },
      projectId: projectId || null,
      inputText: text.slice(0, 2000),
    });
    if (result.needPoints) {
      return res.json({ needPoints: true, feature: result.feature, balance: result.balance, needed: result.needed });
    }
    // 模板引擎时附润色说明
    let changes = [];
    if (!result.model.usedRealAI) {
      const { polishText } = await import('../ai.js');
      changes = polishText({ text }).changes;
    }
    res.json({
      result: result.content,
      changes,
      model: result.model,
      tokens: result.tokens,
      chargeType: result.chargeType,
      amount: result.amount,
      orderId: result.orderId,
      taskId: result.taskId,
      projectId: result.projectId,
      points: result.points,
      deductedPoints: result.deductedPoints,
    });
  } catch (err) {
    res.status(500).json({ error: '润色失败：' + err.message });
  }
});

// ========== 中英翻译（纯文本） ==========
router.post('/translate', authRequired, async (req, res) => {
  const { text, direction, projectId } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: '请输入需要翻译的文本' });
  if (!['zh2en', 'en2zh'].includes(direction)) return res.status(400).json({ error: '请选择翻译方向' });
  const lenErr = checkTextLen(text, MAX_INPUT_CHARS, '文本');
  if (lenErr) return res.status(400).json({ error: lenErr });

  try {
    const result = await executeWithBilling({
      userId: req.user.id,
      featureKey: 'translate',
      toolType: 'translate',
      action: direction,
      params: { text, direction },
      projectId: projectId || null,
      inputText: `[${direction}] ${text.slice(0, 2000)}`,
    });
    if (result.needPoints) {
      return res.json({ needPoints: true, feature: result.feature, balance: result.balance, needed: result.needed });
    }
    res.json({
      result: result.content,
      direction,
      model: result.model,
      tokens: result.tokens,
      chargeType: result.chargeType,
      amount: result.amount,
      orderId: result.orderId,
      taskId: result.taskId,
      projectId: result.projectId,
      points: result.points,
      deductedPoints: result.deductedPoints,
    });
  } catch (err) {
    res.status(500).json({ error: '翻译失败：' + err.message });
  }
});

// ========== 语法纠错（纯文本） ==========
router.post('/grammar', authRequired, async (req, res) => {
  const { text, projectId } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: '请输入需要检查的文本' });
  const lenErr = checkTextLen(text, MAX_INPUT_CHARS, '文本');
  if (lenErr) return res.status(400).json({ error: lenErr });

  try {
    const result = await executeWithBilling({
      userId: req.user.id,
      featureKey: 'grammar',
      toolType: 'grammar',
      action: 'grammar',
      params: { text },
      projectId: projectId || null,
      inputText: text.slice(0, 2000),
    });
    if (result.needPoints) {
      return res.json({ needPoints: true, feature: result.feature, balance: result.balance, needed: result.needed });
    }
    // 始终基于原始输入做纯 JS 语法统计检测（内置模式与真实 AI 模式均附加）
    let issues = [];
    try {
      const { grammarCheck } = await import('../ai.js');
      issues = grammarCheck({ text }).issues;
    } catch (err) {
      logger.error('tools', `语法统计检测失败: ${err.message}`);
    }
    res.json({
      result: result.content,
      issues,
      model: result.model,
      tokens: result.tokens,
      chargeType: result.chargeType,
      amount: result.amount,
      orderId: result.orderId,
      taskId: result.taskId,
      projectId: result.projectId,
      points: result.points,
      deductedPoints: result.deductedPoints,
    });
  } catch (err) {
    res.status(500).json({ error: '检查失败：' + err.message });
  }
});

// ========== 参考文献格式化（不消耗额度） ==========
router.post('/format-reference', authRequired, (req, res) => {
  const { ref, style = 'gbt7714' } = req.body || {};
  if (!ref || !ref.title) return res.status(400).json({ error: '文献信息不完整' });
  res.json({ formatted: formatReference({ ref, style }) });
});

// ========== 论文降重（纯文本） ==========
router.post('/rewrite', authRequired, async (req, res) => {
  const { text, projectId } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: '请输入需要降重的文本' });
  const lenErr = checkTextLen(text, MAX_INPUT_CHARS, '文本');
  if (lenErr) return res.status(400).json({ error: lenErr });

  try {
    const result = await executeWithBilling({
      userId: req.user.id,
      featureKey: 'rewrite',
      toolType: 'rewrite',
      action: 'rewrite',
      params: { text },
      projectId: projectId || null,
      inputText: text.slice(0, 2000),
    });
    if (result.needPoints) {
      return res.json({ needPoints: true, feature: result.feature, balance: result.balance, needed: result.needed });
    }
    // 内置模板引擎时附带降重修改记录
    let changes = [];
    if (!result.model.usedRealAI) {
      const { rewriteText } = await import('../ai.js');
      const detail = rewriteText({ text });
      changes = detail.changes;
    }
    res.json({
      result: result.content,
      changes,
      model: result.model,
      tokens: result.tokens,
      chargeType: result.chargeType,
      amount: result.amount,
      orderId: result.orderId,
      taskId: result.taskId,
      projectId: result.projectId,
      points: result.points,
      deductedPoints: result.deductedPoints,
    });
  } catch (err) {
    res.status(500).json({ error: '降重失败：' + err.message });
  }
});

// ========== 降AI率（借鉴千笔） ==========
router.post('/ai-reduce', authRequired, async (req, res) => {
  const { text, projectId } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: '请输入需要降AI的文本' });
  const lenErr = checkTextLen(text, MAX_INPUT_CHARS, '文本');
  if (lenErr) return res.status(400).json({ error: lenErr });

  try {
    const result = await executeWithBilling({
      userId: req.user.id,
      featureKey: 'ai_reduce',
      toolType: 'ai_reduce',
      action: 'ai_reduce',
      params: { text },
      projectId: projectId || null,
      inputText: text.slice(0, 2000),
    });
    if (result.needPoints) {
      return res.json({ needPoints: true, feature: result.feature, balance: result.balance, needed: result.needed });
    }
    res.json({
      result: result.content,
      model: result.model,
      tokens: result.tokens,
      chargeType: result.chargeType,
      amount: result.amount,
      orderId: result.orderId,
      taskId: result.taskId,
      projectId: result.projectId,
      points: result.points,
      deductedPoints: result.deductedPoints,
    });
  } catch (err) {
    res.status(500).json({ error: '降AI率失败：' + err.message });
  }
});

// ========== 文献综述生成（输出 Word） ==========
router.post('/literature-review', authRequired, async (req, res) => {
  const { topic, field, keywords, years, template_id, projectId } = req.body || {};
  if (!topic) return res.status(400).json({ error: '请填写研究主题' });
  const lenErr = checkTextLen(topic, MAX_TOPIC_CHARS, '主题');
  if (lenErr) return res.status(400).json({ error: lenErr });

  let template = null;
  if (template_id) {
    template = db.prepare('SELECT * FROM templates WHERE id = ? AND (user_id = ? OR is_global = 1)').get(template_id, req.user.id);
  }

  try {
    const result = await executeWithBilling({
      userId: req.user.id,
      featureKey: 'literature_review',
      toolType: 'literature_review',
      action: 'literature_review',
      params: { topic, field, keywords, years },
      projectId: projectId || null,
      inputText: `【文献综述】主题：${topic}${field ? ' | 学科：' + field : ''}`,
      generateDocxOptions: {
        title: `${topic}文献综述`,
        template,
      },
    });
    if (result.needPoints) {
      return res.json({ needPoints: true, feature: result.feature, balance: result.balance, needed: result.needed });
    }
    res.json({
      content: result.content,
      title: `${topic}文献综述`,
      model: result.model,
      tokens: result.tokens,
      doc: result.doc,
      chargeType: result.chargeType,
      amount: result.amount,
      orderId: result.orderId,
      taskId: result.taskId,
      projectId: result.projectId,
      points: result.points,
      deductedPoints: result.deductedPoints,
    });
  } catch (err) {
    res.status(500).json({ error: '文献综述生成失败：' + err.message });
  }
});

// ========== 任务书生成（输出 Word） ==========
router.post('/task-book', authRequired, async (req, res) => {
  const { topic, student_name, student_id, field, advisor, template_id, projectId } = req.body || {};
  if (!topic) return res.status(400).json({ error: '请填写论文题目' });
  const lenErr = checkTextLen(topic, MAX_TOPIC_CHARS, '题目');
  if (lenErr) return res.status(400).json({ error: lenErr });

  let template = null;
  if (template_id) {
    template = db.prepare('SELECT * FROM templates WHERE id = ? AND (user_id = ? OR is_global = 1)').get(template_id, req.user.id);
  }

  try {
    const result = await executeWithBilling({
      userId: req.user.id,
      featureKey: 'task_book',
      toolType: 'task_book',
      action: 'task_book',
      params: { topic, student_name, student_id, field, advisor },
      projectId: projectId || null,
      inputText: `【任务书】题目：${topic}${student_name ? ' | 学生：' + student_name : ''}`,
      generateDocxOptions: {
        title: `${topic}任务书`,
        template,
      },
    });
    if (result.needPoints) {
      return res.json({ needPoints: true, feature: result.feature, balance: result.balance, needed: result.needed });
    }
    res.json({
      content: result.content,
      title: `${topic}任务书`,
      model: result.model,
      tokens: result.tokens,
      doc: result.doc,
      chargeType: result.chargeType,
      amount: result.amount,
      orderId: result.orderId,
      taskId: result.taskId,
      projectId: result.projectId,
      points: result.points,
      deductedPoints: result.deductedPoints,
    });
  } catch (err) {
    res.status(500).json({ error: '任务书生成失败：' + err.message });
  }
});

// ========== 答辩PPT+演讲稿生成（输出 .pptx） ==========
router.post('/defense', authRequired, async (req, res) => {
  const { topic, field, research_content, innovation, duration, projectId } = req.body || {};
  if (!topic) return res.status(400).json({ error: '请填写论文题目' });
  const lenErr = checkTextLen(topic, MAX_TOPIC_CHARS, '题目') || checkTextLen(research_content, MAX_INPUT_CHARS, '研究内容');
  if (lenErr) return res.status(400).json({ error: lenErr });

  try {
    const result = await executeWithBilling({
      userId: req.user.id,
      featureKey: 'defense',
      toolType: 'defense',
      action: 'defense',
      params: { topic, field, research_content, innovation, duration: duration || 10 },
      projectId: projectId || null,
      inputText: `【答辩】题目：${topic}${field ? ' | 学科：' + field : ''}`,
      generatePptxOptions: {
        title: `${topic}答辩PPT`,
      },
    });
    if (result.needPoints) {
      return res.json({ needPoints: true, feature: result.feature, balance: result.balance, needed: result.needed });
    }
    res.json({
      content: result.content,
      title: `${topic}答辩PPT`,
      model: result.model,
      tokens: result.tokens,
      doc: result.doc,
      chargeType: result.chargeType,
      amount: result.amount,
      orderId: result.orderId,
      taskId: result.taskId,
      projectId: result.projectId,
      points: result.points,
      deductedPoints: result.deductedPoints,
    });
  } catch (err) {
    res.status(500).json({ error: '答辩材料生成失败：' + err.message });
  }
});

// ========== 期刊论文撰写（输出 Word） ==========
router.post('/journal', authRequired, async (req, res) => {
  const { topic, field, research_content, method, journal_type, template_id, projectId } = req.body || {};
  if (!topic) return res.status(400).json({ error: '请填写论文题目' });
  const lenErr = checkTextLen(topic, MAX_TOPIC_CHARS, '题目') || checkTextLen(research_content, MAX_INPUT_CHARS, '研究内容');
  if (lenErr) return res.status(400).json({ error: lenErr });

  let template = null;
  if (template_id) {
    template = db.prepare('SELECT * FROM templates WHERE id = ? AND (user_id = ? OR is_global = 1)').get(template_id, req.user.id);
  }

  try {
    const result = await executeWithBilling({
      userId: req.user.id,
      featureKey: 'journal',
      toolType: 'journal',
      action: 'journal',
      params: { topic, field, research_content, method, journal_type },
      projectId: projectId || null,
      inputText: `【期刊论文】题目：${topic}${field ? ' | 学科：' + field : ''}`,
      generateDocxOptions: {
        title: topic,
        template,
      },
    });
    if (result.needPoints) {
      return res.json({ needPoints: true, feature: result.feature, balance: result.balance, needed: result.needed });
    }
    res.json({
      content: result.content,
      title: topic,
      model: result.model,
      tokens: result.tokens,
      doc: result.doc,
      chargeType: result.chargeType,
      amount: result.amount,
      orderId: result.orderId,
      taskId: result.taskId,
      projectId: result.projectId,
      points: result.points,
      deductedPoints: result.deductedPoints,
    });
  } catch (err) {
    res.status(500).json({ error: '期刊论文生成失败：' + err.message });
  }
});

export default router;

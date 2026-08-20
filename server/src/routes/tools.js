import { Router } from 'express';
import { authRequired } from '../middleware.js';
import { runAI } from '../ai-service.js';
import { formatReference, rewriteText } from '../ai.js';
import { logUsage } from '../usage.js';
import logger from '../logger.js';
import { getFeaturePrice } from '../config-store.js';
import { isFreeUnlimitedFeature } from '../services/billing.js';
import { generateDocx } from '../services/docx-generator.js';
import { saveTask, getProject, buildProjectContext, isProjectOwned } from '../services/task-store.js';
import { checkCoherence, aiReduceVersions } from '../services/text-optimize.js';
import { checkContent } from '../services/content-safety.js';
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

// 学术诚信：敏感功能（全文生成/降AI率/降重）使用前必须已同意承诺书
function hasAgreedAcademicIntegrity(userId) {
  const u = db.prepare('SELECT academic_integrity_agreed_at FROM users WHERE id = ?').get(userId);
  return !!u?.academic_integrity_agreed_at;
}

// 免费不限次功能的每用户每小时调用上限：免费引流不意味着无限刷真实大模型成本
const UNLIMITED_HOURLY_LIMIT = 60;
const UNLIMITED_TOOL_ACTION = {
  writing_outline: ['writing', 'outline'],
};

// 工具调用前置：现金直付模式下，免费功能直接放行，收费功能需关联已支付订单
function resolveBilling(userId, featureKey, orderNo) {
  // 免费且不限次的功能（如大纲生成、文献检索），直接放行
  if (isFreeUnlimitedFeature(featureKey)) {
    // 防滥用：按用户每小时调用次数限流（防批量注册后无限刷大模型）
    const ta = UNLIMITED_TOOL_ACTION[featureKey];
    if (ta) {
      const cutoff = Math.floor(Date.now() / 1000) - 3600;
      const cnt = db.prepare(
        'SELECT COUNT(*) as c FROM ai_tasks WHERE user_id = ? AND tool_type = ? AND action = ? AND created_at >= ?'
      ).get(userId, ta[0], ta[1], cutoff).c;
      if (cnt >= UNLIMITED_HOURLY_LIMIT) {
        return { ok: false, error: '免费功能使用过于频繁，请 1 小时后再试' };
      }
    }
    return { ok: true, mode: 'unlimited' };
  }
  if (!orderNo) return { ok: true, mode: 'need_order' };
  const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo);
  if (!order) return { ok: false, error: '订单不存在' };
  if (order.user_id !== userId) return { ok: false, error: '无权使用该订单' };
  if (order.type !== 'feature') return { ok: false, error: '订单类型不正确' };
  if (order.item_type !== featureKey) return { ok: false, error: '订单与功能不匹配' };
  if (order.status !== 'paid') return { ok: false, error: '订单未支付' };
  // failed 允许重试：AI 瞬时失败（超时/网络抖动）不应锁死用户已付费的订单
  if (!['pending', 'processing', 'failed'].includes(order.service_status)) return { ok: false, error: '订单服务已结束' };
  return { ok: true, mode: 'order', order };
}

// 原子抢占订单执行权：pending/failed → processing，防同一订单并发多次生成（一次付费多次白嫖）
// 返回 true 表示本请求获得执行权；false 表示订单正被其他请求处理中
function claimOrderExecution(order) {
  if (!order) return true;
  const r = db.prepare(
    "UPDATE orders SET service_status = 'processing' WHERE id = ? AND service_status IN ('pending', 'failed')"
  ).run(order.id);
  return r.changes === 1;
}

// 通用：执行 AI 调用 + 失败时退款/取消订单
// projectId: 可选，关联论文工作区，用于注入上下文
// inputText: 可选，保存到任务记录的输入摘要文本
// generateDocxOptions: 写作类/开题报告等需要输出 Word 时传入
// generatePptxOptions: 答辩等需要输出 .pptx 时传入（与 generateDocxOptions 互斥）
// transformContent: 可选，对 AI 输出做后处理（如引用/图表占位符替换），在 docx/pptx 生成前执行
async function executeWithBilling({ userId, featureKey, toolType, action, params, generateDocxOptions = null, generatePptxOptions = null, projectId = null, inputText = '', transformContent = null, orderNo = null }) {
  // 安全：校验工作区归属（防跨用户上下文注入），非本人工作区直接拒绝
  if (projectId && !isProjectOwned(userId, projectId)) {
    throw new Error('无权访问该工作区');
  }

  // 内容安全审核：用户输入（调用 AI 前）
  const inCheck = await checkContent(inputText || JSON.stringify(params || {}));
  if (!inCheck.safe) throw new Error(inCheck.reason);

  // 注入工作区上下文（如果有 projectId）—— 先注入，让 token 预估包含上下文用量
  let contextSummary = '';
  if (projectId) {
    const ctx = buildProjectContext(projectId, userId, { currentToolType: toolType, currentAction: action });
    if (ctx.context) {
      params = { ...params, context: ctx.context };
      contextSummary = ctx.summary;
    }
  }

  const bill = resolveBilling(userId, featureKey, orderNo);
  if (!bill.ok) throw new Error(bill.error);

  if (bill.mode === 'need_order') {
    const fp = getFeaturePrice(featureKey);
    return { needOrder: true, featureKey, itemType: featureKey, amount: fp ? fp.price : 0 };
  }

  let chargeType = bill.mode === 'unlimited' ? 'unlimited' : 'paid';
  let amount = bill.order ? bill.order.amount : 0;
  const order = bill.order || null;

  // 原子抢占订单执行权：pending/failed → processing；processing 表示已有请求正在执行。
  // 防并发重放同一 orderNo 造成一次付费多次生成（AI 调用期间订单保持 processing）。
  if (order && !claimOrderExecution(order)) {
    throw new Error('订单正在处理中，请勿重复提交');
  }

  // 执行 AI
  let aiResult;
  try {
    aiResult = await runAI(toolType, params);
    // 内容安全审核：AI 输出（违规则不返回结果）
    const outCheck = await checkContent(aiResult.content);
    if (!outCheck.safe) throw new Error(outCheck.reason);
  } catch (err) {
    // 失败标记订单服务失败（仅当订单仍处于 processing，防覆盖已完成状态；failed 可重试）
    if (order) {
      db.prepare("UPDATE orders SET service_status = 'failed' WHERE id = ? AND service_status = 'processing'").run(order.id);
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

  // 标记订单服务完成（仅当订单仍处于 processing，防并发场景下失败/完成互相覆盖）
  if (order) {
    db.prepare("UPDATE orders SET service_status = 'completed', task_id = ? WHERE id = ? AND service_status = 'processing'").run(taskId, order.id);
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
    orderNo: order?.order_no || null,
  };
}

// ========== AI 论文写作（输出 Word） ==========
router.post('/writing', authRequired, async (req, res) => {
  const { type, topic, field, template_id, projectId, orderNo } = req.body || {};
  if (!type) return res.status(400).json({ error: '请选择写作类型' });
  if (!topic) return res.status(400).json({ error: '请填写论文题目' });
  const lenErr = checkTextLen(topic, MAX_TOPIC_CHARS, '题目');
  if (lenErr) return res.status(400).json({ error: lenErr });

  // 大纲强制确认：全文生成必须先有已确认的大纲（关联论文工作区）
  if (type === 'fulltext') {
    if (!hasAgreedAcademicIntegrity(req.user.id)) {
      return res.status(403).json({ error: '请先阅读并同意《学术诚信承诺书》', needAcademicIntegrity: true });
    }
    if (!projectId) {
      return res.status(400).json({ error: '全文生成前请先创建论文工作区并确认大纲', needConfirmOutline: true });
    }
    const proj = db.prepare('SELECT id, outline_confirmed_at FROM projects WHERE id = ? AND user_id = ?').get(projectId, req.user.id);
    if (!proj) return res.status(404).json({ error: '工作区不存在' });
    if (!proj.outline_confirmed_at) {
      return res.status(400).json({ error: '请先在论文工作区确认大纲后再生成全文', needConfirmOutline: true });
    }
  }

  const featureKey = `writing_${type}`;
  const fp = getFeaturePrice(featureKey);
  if (!fp) return res.status(400).json({ error: '未知的写作类型' });

  // 加载模板
  let template = null;
  if (template_id) {
    template = db.prepare('SELECT * FROM templates WHERE id = ? AND (user_id = ? OR is_global = 1)').get(template_id, req.user.id);
  }

  // 全文/大纲：优先复用工作区已蒸馏的文献/数据（smart-writing 产物），否则实时检索
  // 检索失败降级，不阻断主流程
  let sourceRefs = null;
  let sourceBenchmarks = null;
  let sourceTables = null;
  if (type === 'fulltext' || type === 'outline') {
    if (projectId) {
      try {
        const proj = getProject(projectId, req.user.id);
        const src = proj?.sources || {};
        if (Array.isArray(src.references) && src.references.length > 0) sourceRefs = src.references;
        if (Array.isArray(src.benchmarks) && src.benchmarks.length > 0) sourceBenchmarks = src.benchmarks;
        if (Array.isArray(src.tables) && src.tables.length > 0) sourceTables = src.tables;
      } catch (err) {
        logger.warn('tools', `读取工作区蒸馏产物失败（忽略）: ${err.message}`);
      }
    }
    if (!sourceRefs) {
      try {
        const { collectWritingSources } = await import('../services/paper-distillation.js');
        const { references, benchmarks } = await collectWritingSources(topic, field, '', 8);
        sourceRefs = references;
        sourceBenchmarks = benchmarks;
      } catch (err) {
        logger.warn('tools', `写作检索失败（忽略，改用无文献生成）: ${err.message}`);
      }
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
        ...(sourceTables?.length ? { dataTables: sourceTables } : {}),
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
      orderNo: orderNo || null,
    });
    if (result.needOrder) {
      return res.json({ needOrder: true, itemType: result.itemType, amount: result.amount });
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
      orderNo: result.orderNo,
    });
  } catch (err) {
    res.status(500).json({ error: '生成失败：' + err.message });
  }
});

// ========== 智能写作（检索→蒸馏→原创生成）==========
// 流程：多源检索同方向论文 → MapReduce提取框架 → 融合大纲 → 原创生成
// 现金直付：需关联已支付的 literature_review 订单
router.post('/smart-writing', authRequired, async (req, res) => {
  const { topic, field, keywords, projectId, orderNo } = req.body || {};
  if (!topic) return res.status(400).json({ error: '请填写论文题目' });
  if (!field) return res.status(400).json({ error: '请选择学科领域' });
  const lenErr = checkTextLen(topic, MAX_TOPIC_CHARS, '题目');
  if (lenErr) return res.status(400).json({ error: lenErr });

  // 安全：校验工作区归属（防跨用户上下文注入）
  if (projectId && !isProjectOwned(req.user.id, projectId)) {
    return res.status(403).json({ error: '无权访问该工作区' });
  }

  // 现金直付：智能写作需关联已支付订单
  const bill = resolveBilling(req.user.id, 'literature_review', orderNo);
  if (!bill.ok) return res.status(400).json({ error: bill.error });
  if (bill.mode === 'need_order') {
    const fp = getFeaturePrice('literature_review');
    return res.json({ needOrder: true, itemType: 'literature_review', amount: fp ? fp.price : 0 });
  }
  const order = bill.order || null;

  // 原子抢占：防同一订单并发重复执行（检索+蒸馏耗时数十秒）
  if (order && !claimOrderExecution(order)) {
    return res.status(400).json({ error: '订单正在处理中，请勿重复提交' });
  }

  try {
    const { smartWriting } = await import('../services/paper-distillation.js');
    const result = await smartWriting({ topic, field, keywords, projectId, userId: req.user.id });

    // 蒸馏产物持久化到工作区：分章节生成/全文生成统一消费（框架/文献/数据/表格）
    if (projectId) {
      try {
        const { saveProjectSources } = await import('../services/task-store.js');
        saveProjectSources(projectId, req.user.id, {
          framework: result.framework || null,
          references: result.references || [],
          benchmarks: Array.isArray(result.benchmarks?.data) ? result.benchmarks.data : [],
          tables: result.tables || [],
          sources_used: result.framework?.sources_used || [],
          saved_at: Math.floor(Date.now() / 1000),
        });
      } catch (err) {
        logger.warn('tools', `蒸馏产物持久化失败（忽略，本次仍可使用）: ${err.message}`);
      }
    }

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
      chargeType: order ? 'paid' : 'unlimited',
      amount: order ? order.amount : 0,
      orderId: order?.id || null,
      status: 'success',
    });

    if (order) {
      db.prepare("UPDATE orders SET service_status = 'completed', task_id = ? WHERE id = ? AND service_status = 'processing'").run(taskId, order.id);
    }

    res.json({
      ok: true,
      outline: result.outline,
      references: result.references,
      framework: result.framework,
      benchmarks: result.benchmarks,
      tables: result.tables || [],
      degraded: result.degraded,
      taskId,
      chargeType: order ? 'paid' : 'unlimited',
      amount: order ? order.amount : 0,
      orderNo: order?.order_no || null,
      message: result.degraded
        ? `已检索 ${result.references.length} 篇相关论文（当前为模板降级模式，配置真实 AI 后框架提取与生成更精准）`
        : `已检索 ${result.references.length} 篇相关论文并提取研究框架，可基于此大纲生成分章节论文`,
    });
  } catch (err) {
    if (order) db.prepare("UPDATE orders SET service_status = 'failed' WHERE id = ? AND service_status = 'processing'").run(order.id);
    res.status(500).json({ error: '智能写作失败：' + err.message });
  }
});

// ========== 开题报告撰写（输出 Word） ==========
router.post('/proposal', authRequired, async (req, res) => {
  const { topic, field, direction, keywords, objective, method, innovation, template_id, projectId, orderNo } = req.body || {};
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
      orderNo: orderNo || null,
    });
    if (result.needOrder) {
      return res.json({ needOrder: true, itemType: result.itemType, amount: result.amount });
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
      orderNo: result.orderNo,
    });
  } catch (err) {
    res.status(500).json({ error: '开题报告生成失败：' + err.message });
  }
});

// ========== 论文润色（纯文本） ==========
router.post('/polish', authRequired, async (req, res) => {
  const { text, projectId, orderNo } = req.body || {};
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
      orderNo: orderNo || null,
    });
    if (result.needOrder) {
      return res.json({ needOrder: true, itemType: result.itemType, amount: result.amount });
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
      orderNo: result.orderNo,
    });
  } catch (err) {
    res.status(500).json({ error: '润色失败：' + err.message });
  }
});

// ========== 中英翻译（纯文本） ==========
router.post('/translate', authRequired, async (req, res) => {
  const { text, direction, projectId, orderNo } = req.body || {};
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
      orderNo: orderNo || null,
    });
    if (result.needOrder) {
      return res.json({ needOrder: true, itemType: result.itemType, amount: result.amount });
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
      orderNo: result.orderNo,
    });
  } catch (err) {
    res.status(500).json({ error: '翻译失败：' + err.message });
  }
});

// ========== 语法纠错（纯文本） ==========
router.post('/grammar', authRequired, async (req, res) => {
  const { text, projectId, orderNo } = req.body || {};
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
      orderNo: orderNo || null,
    });
    if (result.needOrder) {
      return res.json({ needOrder: true, itemType: result.itemType, amount: result.amount });
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
      orderNo: result.orderNo,
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
  const { text, projectId, orderNo } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: '请输入需要降重的文本' });
  const lenErr = checkTextLen(text, MAX_INPUT_CHARS, '文本');
  if (lenErr) return res.status(400).json({ error: lenErr });

  if (!hasAgreedAcademicIntegrity(req.user.id)) {
    return res.status(403).json({ error: '请先阅读并同意《学术诚信承诺书》', needAcademicIntegrity: true });
  }

  try {
    // 降重优化：先用内置学术同义词库替换常见连接词，再交给大模型重组句子
    const synonymDetail = rewriteText({ text });
    const result = await executeWithBilling({
      userId: req.user.id,
      featureKey: 'rewrite',
      toolType: 'rewrite',
      action: 'rewrite',
      params: { text: synonymDetail.result },
      projectId: projectId || null,
      inputText: text.slice(0, 2000),
      orderNo: orderNo || null,
    });
    if (result.needOrder) {
      return res.json({ needOrder: true, itemType: result.itemType, amount: result.amount });
    }
    // 内置模板引擎时附带降重修改记录
    const changes = result.model.usedRealAI ? [] : synonymDetail.changes;
    const coherence = checkCoherence(result.content);
    res.json({
      result: result.content,
      changes,
      coherence,
      model: result.model,
      tokens: result.tokens,
      chargeType: result.chargeType,
      amount: result.amount,
      orderId: result.orderId,
      taskId: result.taskId,
      projectId: result.projectId,
      orderNo: result.orderNo,
    });
  } catch (err) {
    res.status(500).json({ error: '降重失败：' + err.message });
  }
});

// ========== 降AI率（借鉴千笔） ==========
router.post('/ai-reduce', authRequired, async (req, res) => {
  const { text, projectId, orderNo } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: '请输入需要降AI的文本' });
  const lenErr = checkTextLen(text, MAX_INPUT_CHARS, '文本');
  if (lenErr) return res.status(400).json({ error: lenErr });

  if (!hasAgreedAcademicIntegrity(req.user.id)) {
    return res.status(403).json({ error: '请先阅读并同意《学术诚信承诺书》', needAcademicIntegrity: true });
  }

  try {
    const result = await executeWithBilling({
      userId: req.user.id,
      featureKey: 'ai_reduce',
      toolType: 'ai_reduce',
      action: 'ai_reduce',
      params: { text },
      projectId: projectId || null,
      inputText: text.slice(0, 2000),
      orderNo: orderNo || null,
    });
    if (result.needOrder) {
      return res.json({ needOrder: true, itemType: result.itemType, amount: result.amount });
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
      orderNo: result.orderNo,
    });
  } catch (err) {
    res.status(500).json({ error: '降AI率失败：' + err.message });
  }
});

// ========== 降AI率（多版本，供用户选择） ==========
router.post('/ai-reduce-versions', authRequired, async (req, res) => {
  const { text, projectId, orderNo } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: '请输入需要降AI的文本' });
  const lenErr = checkTextLen(text, MAX_INPUT_CHARS, '文本');
  if (lenErr) return res.status(400).json({ error: lenErr });

  if (!hasAgreedAcademicIntegrity(req.user.id)) {
    return res.status(403).json({ error: '请先阅读并同意《学术诚信承诺书》', needAcademicIntegrity: true });
  }

  const bill = resolveBilling(req.user.id, 'ai_reduce', orderNo);
  if (!bill.ok) return res.status(400).json({ error: bill.error });
  if (bill.mode === 'need_order') {
    const fp = getFeaturePrice('ai_reduce');
    return res.json({ needOrder: true, itemType: 'ai_reduce', amount: fp ? fp.price : 0 });
  }
  const order = bill.order || null;

  // 原子抢占：防同一订单并发重复执行
  if (order && !claimOrderExecution(order)) {
    return res.status(400).json({ error: '订单正在处理中，请勿重复提交' });
  }

  try {
    const data = await aiReduceVersions(text);
    const taskId = saveTask({
      userId: req.user.id,
      projectId: projectId || null,
      toolType: 'ai_reduce',
      action: 'ai_reduce_versions',
      inputText: text.slice(0, 2000),
      outputText: (data.versions || []).join('\n---\n').slice(0, 5000),
      params: {},
      modelName: data.model?.name || '',
      tokens: data.tokens,
      chargeType: order ? 'paid' : 'unlimited',
      amount: order ? order.amount : 0,
      orderId: order?.id || null,
      status: 'success',
    });
    if (order) {
      db.prepare("UPDATE orders SET service_status = 'completed', task_id = ? WHERE id = ? AND service_status = 'processing'").run(taskId, order.id);
    }
    logUsage({
      userId: req.user.id,
      toolType: 'ai_reduce',
      action: 'ai_reduce_versions',
      model: data.model,
      inputChars: text.length,
      outputChars: (data.versions || []).join('').length,
      tokens: data.tokens,
      status: 'success',
      orderId: order?.id,
      chargeType: order ? 'paid' : 'unlimited',
      amount: order ? order.amount : 0,
    });
    res.json({
      versions: data.versions,
      coherence: data.coherence,
      model: data.model,
      tokens: data.tokens,
      taskId,
      orderNo: order?.order_no || null,
    });
  } catch (err) {
    if (order) db.prepare("UPDATE orders SET service_status = 'failed' WHERE id = ? AND service_status = 'processing'").run(order.id);
    res.status(500).json({ error: '降AI率失败：' + err.message });
  }
});

// ========== 文献综述生成（输出 Word） ==========
router.post('/literature-review', authRequired, async (req, res) => {
  const { topic, field, keywords, years, template_id, projectId, orderNo } = req.body || {};
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
      orderNo: orderNo || null,
    });
    if (result.needOrder) {
      return res.json({ needOrder: true, itemType: result.itemType, amount: result.amount });
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
      orderNo: result.orderNo,
    });
  } catch (err) {
    res.status(500).json({ error: '文献综述生成失败：' + err.message });
  }
});

// ========== 任务书生成（输出 Word） ==========
router.post('/task-book', authRequired, async (req, res) => {
  const { topic, student_name, student_id, field, advisor, template_id, projectId, orderNo } = req.body || {};
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
      orderNo: orderNo || null,
    });
    if (result.needOrder) {
      return res.json({ needOrder: true, itemType: result.itemType, amount: result.amount });
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
      orderNo: result.orderNo,
    });
  } catch (err) {
    res.status(500).json({ error: '任务书生成失败：' + err.message });
  }
});

// ========== 答辩PPT+演讲稿生成（输出 .pptx） ==========
router.post('/defense', authRequired, async (req, res) => {
  const { topic, field, research_content, innovation, duration, projectId, orderNo } = req.body || {};
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
      orderNo: orderNo || null,
    });
    if (result.needOrder) {
      return res.json({ needOrder: true, itemType: result.itemType, amount: result.amount });
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
      orderNo: result.orderNo,
    });
  } catch (err) {
    res.status(500).json({ error: '答辩材料生成失败：' + err.message });
  }
});

// ========== 期刊论文撰写（输出 Word） ==========
router.post('/journal', authRequired, async (req, res) => {
  const { topic, field, research_content, method, journal_type, template_id, projectId, orderNo } = req.body || {};
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
      orderNo: orderNo || null,
    });
    if (result.needOrder) {
      return res.json({ needOrder: true, itemType: result.itemType, amount: result.amount });
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
      orderNo: result.orderNo,
    });
  } catch (err) {
    res.status(500).json({ error: '期刊论文生成失败：' + err.message });
  }
});

export default router;

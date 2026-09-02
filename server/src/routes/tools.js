import { Router } from 'express';
import { authRequired } from '../middleware.js';
import { aiToolLimiter } from '../middleware/rateLimit.js';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import { runAI } from '../ai-service.js';
import { formatReference, rewriteText } from '../ai.js';
import { logUsage } from '../usage.js';
import logger from '../logger.js';
import { getFeaturePrice, getSetting } from '../config-store.js';
import { isFreeUnlimitedFeature, materialFee, materialBillableTokens, MATERIAL_MAX_CHARS_PER, MATERIAL_TOTAL_CHARS_MAX } from '../services/billing.js';
import { generateDocx } from '../services/docx-generator.js';
import { saveTask, updateTaskResult, getProject, saveProjectSources, saveProjectOutline, ensureAutoProject, buildProjectContext, isProjectOwned, classifyTaskError } from '../services/task-store.js';
import { checkCoherence, aiReduceVersions } from '../services/text-optimize.js';
import { checkContent } from '../services/content-safety.js';
import { claimOrderExecution } from '../services/order-claim.js';
import { transitionServiceToFailed, transitionServiceToCompleted } from '../services/order-state.js';
import db from '../db.js';

const router = Router();

// AI 工具统一限流：每用户每分钟最多 60 次（覆盖全部 /tools 写操作，防大模型成本被批量刷，M-2）
router.use((req, res, next) => {
  if (req.method === 'POST') return aiToolLimiter(req, res, next);
  next();
});

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

// 同一订单生成尝试次数上限（含首次，按 usage_logs 中该订单的记录数统计）：
// failed 订单允许重试（AI 瞬时失败不应锁死已付费订单），但重试计入上限，超出要求重新下单
const ORDER_MAX_GENERATION_ATTEMPTS = 3;

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
  // failed 允许重试：AI 瞬时失败（超时/网络抖动）不应锁死用户已付费的订单，
  // 但重试计入次数上限（usage_logs 统计该订单的生成尝试次数），超出要求重新下单
  if (!['pending', 'processing', 'failed'].includes(order.service_status)) return { ok: false, error: '订单服务已结束' };
  if (order.service_status === 'failed') {
    const attempts = db.prepare('SELECT COUNT(*) AS c FROM usage_logs WHERE order_id = ?').get(order.id).c;
    if (attempts >= ORDER_MAX_GENERATION_ATTEMPTS) {
      return { ok: false, error: `该订单已生成失败 ${attempts} 次，达到重试上限，请重新下单` };
    }
  }
  return { ok: true, mode: 'order', order };
}

// 推断自动工作区标题：论文类工具按题目建区；无题目的文本优化类统一归「文本优化」区
function inferAutoProjectTitle(params) {
  if (params && typeof params === 'object' && params.topic) {
    return String(params.topic).trim().slice(0, 100) || '未命名工作区';
  }
  return '文本优化';
}

// 加载用户材料：校验归属并返回 { ids, tokens, texts }
// 注入与计费规则（防「计费与注入脱钩」）：
// - 每份材料仅注入前 20000 字符（MATERIAL_MAX_CHARS_PER，控制 token 成本）
// - 单次调用注入总量上限 60000 字符（MATERIAL_TOTAL_CHARS_MAX），超限直接报错而非静默截断
// - 计费 token 按实际注入的字符量折算（materialBillableTokens），不再按材料完整 tokens 计费
function loadUserMaterials(materialIds, userId) {
  const ids = (Array.isArray(materialIds) ? materialIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return { ids: [], tokens: 0, texts: [] };
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT id, tokens, text_content FROM materials WHERE user_id = ? AND id IN (${placeholders})`
  ).all(userId, ...ids);
  if (rows.length !== new Set(ids).size) {
    throw bizError('部分资料不存在或无权使用，请重新选择');
  }
  // 每份材料截断到注入上限（与生成时注入上下文的文本一致）
  const texts = rows.map((r) => String(r.text_content || '').slice(0, MATERIAL_MAX_CHARS_PER));
  // 注入总量上限：超限报错而非静默截断，避免用户付费后上下文被悄悄砍掉
  const totalChars = texts.reduce((s, t) => s + t.length, 0);
  if (totalChars > MATERIAL_TOTAL_CHARS_MAX) {
    throw bizError(`参考材料过多，请精简后再试（单次最多注入 ${MATERIAL_TOTAL_CHARS_MAX} 字符，当前 ${totalChars}）`);
  }
  return {
    ids,
    // 计费与注入对齐：按实际注入量折算 token，总量 60000 封顶
    tokens: materialBillableTokens(texts),
    texts,
  };
}


// 业务校验错误（客户端错误 400）：与 AI 服务错误（502/504 等）区分状态码
function bizError(message) {
  const e = new Error(message);
  e.statusCode = 400;
  return e;
}
// 通用：执行 AI 调用 + 失败时退款/取消订单
// projectId: 可选，关联论文工作区，用于注入上下文
// materialIds: 可选，参考材料 id 列表——材料解读 token 计入订单费用，生成时注入上下文
// inputText: 可选，保存到任务记录的输入摘要文本
// generateDocxOptions: 写作类/开题报告等需要输出 Word 时传入
// generatePptxOptions: 答辩等需要输出 .pptx 时传入（与 generateDocxOptions 互斥）
// transformContent: 可选，对 AI 输出做后处理（如引用/图表占位符替换），在 docx/pptx 生成前执行
export async function executeWithBilling({ userId, featureKey, toolType, action, params, generateDocxOptions = null, generatePptxOptions = null, projectId = null, inputText = '', transformContent = null, orderNo = null, materialIds = null, existingTaskId = null, skipClaim = false }) {
  // 安全：校验工作区归属（防跨用户上下文注入），非本人工作区直接拒绝
  if (projectId && !isProjectOwned(userId, projectId)) {
    throw bizError('无权访问该工作区');
  }

  // 加载参考材料（归属校验；失败直接拒绝）
  const materials = loadUserMaterials(materialIds, userId);

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
  if (!bill.ok) throw bizError(bill.error);

  if (bill.mode === 'need_order') {
    const fp = getFeaturePrice(featureKey);
    // 金额 = 功能价 + 材料解读 token 费（与 AI 计费模型一致）
    const fee = materialFee(materials.tokens);
    const total = Math.round(((fp ? fp.price : 0) + fee) * 100) / 100;
    return {
      needOrder: true,
      featureKey,
      itemType: featureKey,
      amount: total,
      materialFee: fee,
      materialTokens: materials.tokens,
      materialIds: materials.ids,
    };
  }

  let chargeType = bill.mode === 'unlimited' ? 'unlimited' : 'paid';
  let amount = bill.order ? bill.order.amount : 0;
  const order = bill.order || null;

  // 订单材料一致性校验：生成所用资料必须在已支付订单包含的资料范围内（防未付费材料注入）
  if (order && materials.ids.length > 0) {
    let meta = {};
    try { meta = JSON.parse(order.metadata || '{}'); } catch { meta = {}; }
    const ordered = Array.isArray(meta.material_ids) ? meta.material_ids : [];
    const missing = materials.ids.filter((id) => !ordered.includes(id));
    if (missing.length > 0) {
      throw bizError('生成所用资料与订单不一致，请重新下单（资料解读费用按订单计收）');
    }
  }

  // 未指定工作区时按题目自动创建/复用自动工作区：内容自动归档，防止散落丢失
  // （放在付费检查之后：未付费的 needOrder 引导不产生工作区副作用）
  let autoProject = false;
  if (!projectId) {
    projectId = ensureAutoProject(userId, inferAutoProjectTitle(params));
    autoProject = true;
  }

  // 原子抢占订单执行权：pending/failed → processing；processing 表示已有请求正在执行。
  // 防并发重放同一 orderNo 造成一次付费多次生成（AI 调用期间订单保持 processing）。
  if (order && !skipClaim && !claimOrderExecution(order)) {
    throw bizError('订单正在处理中，请勿重复提交');
  }

  // 注入参考材料上下文（用户资料，仅作参考不得照抄）
  if (materials.texts.length > 0) {
    params = { ...params, materials: materials.texts };
  }

  // 执行 AI
  let aiResult;
  try {
    aiResult = await runAI(toolType, params);
    // 内容安全审核：AI 输出（违规则不返回结果）
    const outCheck = await checkContent(aiResult.content);
    if (!outCheck.safe) throw new Error(outCheck.reason);
  } catch (err) {
    // 失败标记订单服务失败（仅当订单仍处于 processing，防覆盖已完成状态；failed 可重试）。
    // 服务失败绝不改变支付状态（orders.status 保持 paid），二者为独立维度。
    if (order) {
      transitionServiceToFailed(order.id, { reason: 'AI 执行失败' });
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
    // 保存失败任务（带错误分类码，供任务中心展示「重新执行」或「联系客服」）
    try {
      const cls = classifyTaskError(err);
      if (existingTaskId) {
        updateTaskResult(existingTaskId, userId, { status: 'failed', outputText: '', errorCode: cls.code });
      } else {
        saveTask({
          userId,
          projectId: projectId || null,
          toolType,
          action,
          inputText: inputText || JSON.stringify(params).slice(0, 2000),
          outputText: '',
          params: (() => { const p = { ...params }; delete p.context; return p; })(),
          contextSummary,
          modelName: '',
          tokens: 0,
          chargeType,
          amount,
          orderId: order?.id || null,
          status: 'failed',
          errorCode: cls.code,
        });
      }
    } catch (e) {
      logger.error('tools', `failed-task-save failed: ${e.message}`);
    }
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
        projectId: projectId || null,
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
        projectId: projectId || null,
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
  let taskId = existingTaskId || null;
  try {
    if (existingTaskId) {
      updateTaskResult(existingTaskId, userId, { status: 'success', outputText: aiResult.content, modelName: aiResult.model?.name || '', tokens: aiResult.tokens, progress: 100 });
    } else {
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
    }
  } catch (err) {
    logger.error('tools', `task-save failed: ${err.message}`);
  }

  // 标记订单服务完成（仅当订单仍处于 processing，防并发场景下失败/完成互相覆盖）
  if (order) {
    transitionServiceToCompleted(order.id, { taskId, reason: '生成完成' });
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
    // 自动归档提示：本次内容已自动保存到工作区（前端 toast 提示用户）
    autoProject,
    autoProjectTitle: autoProject ? inferAutoProjectTitle(params) : null,
    retention_days: parseInt(getSetting('doc_retention_days', '30'), 10) || 30,
    orderNo: order?.order_no || null,
  };
}

// ========== 统一文档生成器（P1-7）==========
// 开题报告/文献综述/任务书/答辩/期刊论文等"提交参数 → AI 生成 → 输出文档"类工具，
// 共享同一套模板加载、计费执行与标准响应，消除各端点间的重复代码。

// 加载格式模板：仅本人上传或全局共享的模板可用；未传或无权返回 null
function loadTemplate(templateId, userId) {
  if (!templateId) return null;
  return db.prepare('SELECT * FROM templates WHERE id = ? AND (user_id = ? OR is_global = 1)').get(templateId, userId);
}

// 执行文档类工具并返回标准响应（含 docx/pptx 生成；错误前缀用于统一报错文案）
async function runDocumentTool(req, res, {
  featureKey,
  toolType,
  action,
  params,
  inputText,
  docTitle,
  generateDocxOptions = null,
  generatePptxOptions = null,
  errorPrefix = '生成',
}) {
  try {
    const result = await executeWithBilling({
      userId: req.user.id,
      featureKey,
      toolType,
      action,
      params,
      projectId: req.body?.projectId || null,
      inputText,
      generateDocxOptions,
      generatePptxOptions,
      orderNo: req.body?.orderNo || null,
      materialIds: (req.body && req.body.material_ids) || null,
    });
    if (result.needOrder) {
      return res.json({ ...result });
    }
    res.json({
      content: result.content,
      title: docTitle,
      model: result.model,
      tokens: result.tokens,
      doc: result.doc,
      chargeType: result.chargeType,
      amount: result.amount,
      orderId: result.orderId,
      taskId: result.taskId,
      projectId: result.projectId,
      autoProject: result.autoProject,
      autoProjectTitle: result.autoProjectTitle,
      retention_days: result.retention_days,
      orderNo: result.orderNo,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: `${errorPrefix}失败：` + err.message });
  }
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
    // 大纲生成（免费快速版）：把检索到的真实文献/数据持久化到工作区，
    // 供后续章节/全文生成复用；已有深度蒸馏产物（framework 非空）时保留不覆盖
    if (type === 'outline' && projectId && sourceRefs?.length) {
      try {
        const existing = getProject(projectId, req.user.id)?.sources || {};
        if (!existing.framework) {
          saveProjectSources(projectId, req.user.id, {
            framework: existing.framework || null,
            references: sourceRefs,
            benchmarks: sourceBenchmarks || [],
            tables: existing.tables || [],
            sources_used: existing.sources_used || [],
            saved_at: Math.floor(Date.now() / 1000),
          });
        }
      } catch (err) {
        logger.warn('tools', `大纲来源持久化失败（忽略）: ${err.message}`);
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
      materialIds: (req.body && req.body.material_ids) || null,
    });
    if (result.needOrder) {
      return res.json({ ...result });
    }

    // 全文生成后审校链（借鉴 GPT Researcher reviewer→revisor 闭环）：
    // 规则审校（免费确定性检查）→ AI 审校 → 发现问题自动修订 → 复核；
    // 修订发生则替换内容并重新生成 Word。仅真实 AI 下执行，各环节失败均降级保留原结果
    let review = null;
    let reviewChain = null;
    if (type === 'fulltext' && result.model?.usedRealAI && result.content) {
      try {
        const { runReviewChain } = await import('../services/review-chain.js');
        const chain = await runReviewChain({
          content: result.content,
          references: sourceRefs || [],
          userId: req.user.id,
          logUsage,
        });
        review = chain.report || null;
        reviewChain = {
          revised: chain.revised,
          verdict: chain.verdict,
          recheckVerdict: chain.recheckVerdict,
          initialFindings: chain.initialFindings,
          findings: chain.findings,
          reviseNote: chain.reviseNote,
        };
        if (chain.revised && chain.content) {
          // 修订稿与首次输出执行同级内容安全审核，未通过则保留原稿
          const revisedCheck = await checkContent(chain.content);
          if (revisedCheck.safe) {
            result.content = chain.content;
            try {
              const newDoc = await generateDocx({
                title: topic,
                template,
                userId: req.user.id,
                feature: featureKey,
                orderId: result.orderId || null,
                projectId: result.projectId || null,
                content: chain.content,
              });
              if (newDoc) result.doc = newDoc;
            } catch (err) {
              logger.error('tools', `修订稿 docx 重新生成失败（保留原 Word）: ${err.message}`);
            }
          } else {
            logger.warn('tools', `修订稿内容安全未通过（${revisedCheck.reason}），保留原稿`);
            reviewChain.revised = false;
            reviewChain.recheckVerdict = null;
            reviewChain.reviseNote = '修订稿未通过内容安全审核，已保留原稿';
          }
        }
      } catch (err) {
        logger.warn('tools', `审校链失败（忽略）: ${err.message}`);
      }
    }

    // 大纲生成：解析为结构化大纲并写入工作区（此前只返回文本，工作区看不到大纲、无法进入全文写作）
    // 防静默覆盖：用户已确认（或已编辑）的大纲不被同题再次免费生成覆盖，避免编辑成果无声丢失
    if (type === 'outline' && result.projectId && result.content) {
      try {
        const proj = getProject(result.projectId, req.user.id);
        if (proj && proj.outline_confirmed_at) {
          logger.warn('tools', `大纲已确认，跳过自动覆盖 project=${result.projectId}`);
        } else {
          const { outlineTextToStructure } = await import('../services/paper-distillation.js');
          const structure = outlineTextToStructure(result.content);
          if (structure.length > 0) {
            saveProjectOutline(result.projectId, req.user.id, structure);
          }
        }
      } catch (err) {
        logger.warn('tools', `大纲结构化写入失败（忽略，仅影响工作区大纲展示）: ${err.message}`);
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
      reviewChain,
      chargeType: result.chargeType,
      amount: result.amount,
      orderId: result.orderId,
      taskId: result.taskId,
      projectId: result.projectId,
      autoProject: result.autoProject,
      autoProjectTitle: result.autoProjectTitle,
      retention_days: result.retention_days,
      autoProject: result.autoProject,
      autoProjectTitle: result.autoProjectTitle,
      retention_days: result.retention_days,
      orderNo: result.orderNo,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: '生成失败：' + err.message });
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

  // 未指定工作区时按题目自动创建/复用自动工作区：蒸馏产物自动归档，防止丢失
  let autoProject = false;
  let effectiveProjectId = projectId;
  if (!effectiveProjectId) {
    effectiveProjectId = ensureAutoProject(req.user.id, String(topic).trim().slice(0, 100));
    autoProject = true;
  }

  // 原子抢占：防同一订单并发重复执行（检索+蒸馏耗时数十秒）
  if (order && !claimOrderExecution(order)) {
    return res.status(400).json({ error: '订单正在处理中，请勿重复提交' });
  }

  try {
    const { smartWriting } = await import('../services/paper-distillation.js');
    const result = await smartWriting({ topic, field, keywords, projectId: effectiveProjectId, userId: req.user.id });

    // 蒸馏产物持久化到工作区：分章节生成/全文生成统一消费（框架/文献/数据/表格）
    try {
      const { saveProjectSources } = await import('../services/task-store.js');
      saveProjectSources(effectiveProjectId, req.user.id, {
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

    // 深度调研大纲同步写入工作区结构化大纲：工作区可直接查看/确认/进入全文写作
    try {
      const { outlineTextToStructure } = await import('../services/paper-distillation.js');
      const structure = outlineTextToStructure(result.outline);
      if (structure.length > 0) {
        saveProjectOutline(effectiveProjectId, req.user.id, structure);
      }
    } catch (err) {
      logger.warn('tools', `深度调研大纲结构化写入失败（忽略）: ${err.message}`);
    }

    const taskId = saveTask({
      userId: req.user.id,
      projectId: effectiveProjectId,
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
      transitionServiceToCompleted(order.id, { taskId });
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
      projectId: effectiveProjectId,
      autoProject,
      autoProjectTitle: autoProject ? String(topic).trim().slice(0, 100) : null,
      retention_days: parseInt(getSetting('doc_retention_days', '30'), 10) || 30,
      chargeType: order ? 'paid' : 'unlimited',
      amount: order ? order.amount : 0,
      orderNo: order?.order_no || null,
      message: result.degraded
        ? `已检索 ${result.references.length} 篇相关论文（当前为模板降级模式，配置真实 AI 后框架提取与生成更精准）`
        : `已检索 ${result.references.length} 篇相关论文并提取研究框架，可基于此大纲生成分章节论文`,
    });
  } catch (err) {
    if (order) transitionServiceToFailed(order.id);
    res.status(err.statusCode || 500).json({ error: '智能写作失败：' + err.message });
  }
});

// ========== 开题报告撰写（输出 Word） ==========
router.post('/proposal', authRequired, async (req, res) => {
  const { topic, field, direction, keywords, objective, method, innovation, template_id } = req.body || {};
  if (!topic) return res.status(400).json({ error: '请填写论文题目' });
  if (!field) return res.status(400).json({ error: '请选择学科领域' });
  const lenErr = checkTextLen(topic, MAX_TOPIC_CHARS, '题目') || checkTextLen(objective, MAX_INPUT_CHARS, '研究目标') || checkTextLen(method, MAX_INPUT_CHARS, '研究方法');
  if (lenErr) return res.status(400).json({ error: lenErr });

  await runDocumentTool(req, res, {
    featureKey: 'proposal',
    toolType: 'proposal',
    action: 'proposal',
    params: { topic, field, direction, keywords, objective, method, innovation },
    inputText: `【开题报告】题目：${topic} | 学科：${field}`,
    docTitle: `${topic}开题报告`,
    generateDocxOptions: { title: `${topic}开题报告`, template: loadTemplate(template_id, req.user.id) },
    errorPrefix: '开题报告生成',
  });
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
      materialIds: (req.body && req.body.material_ids) || null,
    });
    if (result.needOrder) {
      return res.json({ ...result });
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
      autoProject: result.autoProject,
      autoProjectTitle: result.autoProjectTitle,
      retention_days: result.retention_days,
      orderNo: result.orderNo,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: '润色失败：' + err.message });
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
      materialIds: (req.body && req.body.material_ids) || null,
    });
    if (result.needOrder) {
      return res.json({ ...result });
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
      autoProject: result.autoProject,
      autoProjectTitle: result.autoProjectTitle,
      retention_days: result.retention_days,
      orderNo: result.orderNo,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: '翻译失败：' + err.message });
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
      materialIds: (req.body && req.body.material_ids) || null,
    });
    if (result.needOrder) {
      return res.json({ ...result });
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
      autoProject: result.autoProject,
      autoProjectTitle: result.autoProjectTitle,
      retention_days: result.retention_days,
      orderNo: result.orderNo,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: '检查失败：' + err.message });
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
  if (!text || !text.trim()) return res.status(400).json({ error: '请输入需要优化的文本' });
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
      materialIds: (req.body && req.body.material_ids) || null,
    });
    if (result.needOrder) {
      return res.json({ ...result });
    }
    // 内置模板引擎时附带降重修改记录
    const changes = result.model.usedRealAI ? [] : synonymDetail.changes;
    const coherence = checkCoherence(result.content);
    res.json({
      result: result.content,
      // 引擎透明度：真实反映本次降重使用的引擎（builtin=内置规则改写未调 AI，ai=大模型）
      engine: result.model.usedRealAI ? 'ai' : 'builtin',
      changes,
      coherence,
      model: result.model,
      tokens: result.tokens,
      chargeType: result.chargeType,
      amount: result.amount,
      orderId: result.orderId,
      taskId: result.taskId,
      projectId: result.projectId,
      autoProject: result.autoProject,
      autoProjectTitle: result.autoProjectTitle,
      retention_days: result.retention_days,
      orderNo: result.orderNo,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: '优化失败：' + err.message });
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
      materialIds: (req.body && req.body.material_ids) || null,
    });
    if (result.needOrder) {
      return res.json({ ...result });
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
      autoProject: result.autoProject,
      autoProjectTitle: result.autoProjectTitle,
      retention_days: result.retention_days,
      orderNo: result.orderNo,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: '表达优化失败：' + err.message });
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
      transitionServiceToCompleted(order.id, { taskId });
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
    if (order) transitionServiceToFailed(order.id);
    res.status(err.statusCode || 500).json({ error: '表达优化失败：' + err.message });
  }
});

// ========== 文献综述生成（输出 Word） ==========
router.post('/literature-review', authRequired, async (req, res) => {
  const { topic, field, keywords, years, template_id } = req.body || {};
  if (!topic) return res.status(400).json({ error: '请填写研究主题' });
  const lenErr = checkTextLen(topic, MAX_TOPIC_CHARS, '主题');
  if (lenErr) return res.status(400).json({ error: lenErr });

  await runDocumentTool(req, res, {
    featureKey: 'literature_review',
    toolType: 'literature_review',
    action: 'literature_review',
    params: { topic, field, keywords, years },
    inputText: `【文献综述】主题：${topic}${field ? ' | 学科：' + field : ''}`,
    docTitle: `${topic}文献综述`,
    generateDocxOptions: { title: `${topic}文献综述`, template: loadTemplate(template_id, req.user.id) },
    errorPrefix: '文献综述生成',
  });
});

// ========== 任务书生成（输出 Word） ==========
router.post('/task-book', authRequired, async (req, res) => {
  const { topic, student_name, student_id, field, advisor, template_id } = req.body || {};
  if (!topic) return res.status(400).json({ error: '请填写论文题目' });
  const lenErr = checkTextLen(topic, MAX_TOPIC_CHARS, '题目');
  if (lenErr) return res.status(400).json({ error: lenErr });

  await runDocumentTool(req, res, {
    featureKey: 'task_book',
    toolType: 'task_book',
    action: 'task_book',
    params: { topic, student_name, student_id, field, advisor },
    inputText: `【任务书】题目：${topic}${student_name ? ' | 学生：' + student_name : ''}`,
    docTitle: `${topic}任务书`,
    generateDocxOptions: { title: `${topic}任务书`, template: loadTemplate(template_id, req.user.id) },
    errorPrefix: '任务书生成',
  });
});

// ========== 答辩PPT+演讲稿生成（输出 .pptx） ==========
router.post('/defense', authRequired, async (req, res) => {
  const { topic, field, research_content, innovation, duration } = req.body || {};
  if (!topic) return res.status(400).json({ error: '请填写论文题目' });
  const lenErr = checkTextLen(topic, MAX_TOPIC_CHARS, '题目') || checkTextLen(research_content, MAX_INPUT_CHARS, '研究内容');
  if (lenErr) return res.status(400).json({ error: lenErr });

  await runDocumentTool(req, res, {
    featureKey: 'defense',
    toolType: 'defense',
    action: 'defense',
    params: { topic, field, research_content, innovation, duration: duration || 10 },
    inputText: `【答辩】题目：${topic}${field ? ' | 学科：' + field : ''}`,
    docTitle: `${topic}答辩PPT`,
    generatePptxOptions: { title: `${topic}答辩PPT` },
    errorPrefix: '答辩材料生成',
  });
});

// ========== 期刊论文撰写（输出 Word） ==========
router.post('/journal', authRequired, async (req, res) => {
  const { topic, field, research_content, method, journal_type, template_id } = req.body || {};
  if (!topic) return res.status(400).json({ error: '请填写论文题目' });
  const lenErr = checkTextLen(topic, MAX_TOPIC_CHARS, '题目') || checkTextLen(research_content, MAX_INPUT_CHARS, '研究内容');
  if (lenErr) return res.status(400).json({ error: lenErr });

  await runDocumentTool(req, res, {
    featureKey: 'journal',
    toolType: 'journal',
    action: 'journal',
    params: { topic, field, research_content, method, journal_type },
    inputText: `【期刊论文】题目：${topic}${field ? ' | 学科：' + field : ''}`,
    docTitle: topic,
    generateDocxOptions: { title: topic, template: loadTemplate(template_id, req.user.id) },
    errorPrefix: '期刊论文生成',
  });
});

// ========== 专利申请辅助：专利技术交底书撰写（输出 Word） ==========
router.post('/patent-draft', authRequired, async (req, res) => {
  const { title, tech_description, template_id, projectId, orderNo } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: '请填写发明名称' });
  const lenErr = checkTextLen(title, MAX_TOPIC_CHARS, '发明名称') || checkTextLen(tech_description, MAX_INPUT_CHARS, '技术方案');
  if (lenErr) return res.status(400).json({ error: lenErr });

  let template = null;
  if (template_id) {
    template = db.prepare('SELECT * FROM templates WHERE id = ? AND (user_id = ? OR is_global = 1)').get(template_id, req.user.id);
  }

  try {
    const result = await executeWithBilling({
      userId: req.user.id,
      featureKey: 'patent_draft',
      toolType: 'patent_draft',
      action: 'patent_draft',
      params: { title: String(title).trim(), text: tech_description || '' },
      projectId: projectId || null,
      inputText: `【专利交底书】发明名称：${title}`,
      generateDocxOptions: { title: `${title}专利技术交底书`, template },
      orderNo: orderNo || null,
      materialIds: (req.body && req.body.material_ids) || null,
    });
    if (result.needOrder) {
      return res.json({ ...result });
    }
    res.json({
      content: result.content,
      title: `${title}专利技术交底书`,
      model: result.model,
      tokens: result.tokens,
      doc: result.doc,
      chargeType: result.chargeType,
      amount: result.amount,
      orderId: result.orderId,
      taskId: result.taskId,
      projectId: result.projectId,
      autoProject: result.autoProject,
      autoProjectTitle: result.autoProjectTitle,
      retention_days: result.retention_days,
      orderNo: result.orderNo,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: '专利交底书生成失败：' + err.message });
  }
});

// ========== 期刊发表辅助：审稿意见回复（输出 Word） ==========
router.post('/review-reply', authRequired, async (req, res) => {
  const { paper_title, field, review_comments, template_id, projectId, orderNo } = req.body || {};
  if (!paper_title || !String(paper_title).trim()) return res.status(400).json({ error: '请填写论文标题' });
  const lenErr = checkTextLen(paper_title, MAX_TOPIC_CHARS, '论文标题') || checkTextLen(review_comments, MAX_INPUT_CHARS, '审稿意见');
  if (lenErr) return res.status(400).json({ error: lenErr });

  let template = null;
  if (template_id) {
    template = db.prepare('SELECT * FROM templates WHERE id = ? AND (user_id = ? OR is_global = 1)').get(template_id, req.user.id);
  }

  try {
    const result = await executeWithBilling({
      userId: req.user.id,
      featureKey: 'review_reply',
      toolType: 'review_reply',
      action: 'review_reply',
      params: { title: String(paper_title).trim(), field: field || '', text: review_comments || '' },
      projectId: projectId || null,
      inputText: `【审稿意见回复】论文标题：${paper_title}`,
      generateDocxOptions: { title: `审稿意见回复信-${paper_title}`, template },
      orderNo: orderNo || null,
      materialIds: (req.body && req.body.material_ids) || null,
    });
    if (result.needOrder) {
      return res.json({ ...result });
    }
    res.json({
      content: result.content,
      title: `审稿意见回复信-${paper_title}`,
      model: result.model,
      tokens: result.tokens,
      doc: result.doc,
      chargeType: result.chargeType,
      amount: result.amount,
      orderId: result.orderId,
      taskId: result.taskId,
      projectId: result.projectId,
      autoProject: result.autoProject,
      autoProjectTitle: result.autoProjectTitle,
      retention_days: result.retention_days,
      orderNo: result.orderNo,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: '审稿意见回复生成失败：' + err.message });
  }
});

// ========== 整篇文档改写（降重 / 降AI率）==========
// 上传 .docx → 仅改写正文段落（保留格式/标题/图表/图片/公式/表格）→ 返回新 docx 下载
const docUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

async function handleDocRewrite(req, res, tool) {
  const featureKey = tool; // rewrite / ai_reduce
  if (!req.file) return res.status(400).json({ error: '请上传 .docx 文档' });
  if (!String(req.file.originalname || '').toLowerCase().endsWith('.docx')) {
    return res.status(400).json({ error: '仅支持 .docx 格式文档' });
  }
  if (!hasAgreedAcademicIntegrity(req.user.id)) {
    return res.status(403).json({ error: '请先阅读并同意《学术诚信承诺书》', needAcademicIntegrity: true });
  }

  const orderNo = (req.body && req.body.orderNo) || null;
  const bill = resolveBilling(req.user.id, featureKey, orderNo);
  if (!bill.ok) return res.status(400).json({ error: bill.error });
  if (bill.mode === 'need_order') {
    const fp = getFeaturePrice(featureKey);
    return res.json({ needOrder: true, featureKey, itemType: featureKey, amount: fp ? fp.price : 0, materialFee: 0, materialTokens: 0, materialIds: [] });
  }
  const order = bill.order || null;
  if (order && !claimOrderExecution(order)) {
    return res.status(400).json({ error: '订单正在处理中，请勿重复提交' });
  }

  try {
    const { rewriteDocxBuffer } = await import('../services/docx-rewrite.js');
    const { buffer, stats } = await rewriteDocxBuffer(req.file.buffer, tool);

    // 保存生成文档（docs 下载接口按用户鉴权，30 天保留）
    const prefix = tool === 'rewrite' ? '重复表达优化' : '表达自然度优化';
    const safeName = String(req.file.originalname || '文档').replace(/\.docx$/i, '').replace(/[^\w\u4e00-\u9fa5.-]/g, '_').slice(0, 80);
    const fileName = `${req.user.id}_${Date.now()}_${featureKey}_${safeName}.docx`;
    const docsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'uploads', 'docs');
    if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(join(docsDir, fileName), buffer);

    const info = db.prepare(
      'INSERT INTO generated_docs (user_id, title, feature, file_path, order_id) VALUES (?, ?, ?, ?, ?)'
    ).run(req.user.id, `${prefix}_${safeName}`, featureKey, fileName, order?.id || null);

    // 记录使用日志（财务核对）
    logUsage({
      userId: req.user.id,
      toolType: tool,
      action: tool + '_doc',
      model: { name: 'multi-batch' },
      inputChars: stats.totalChars,
      outputChars: stats.totalChars,
      tokens: 0,
      status: 'success',
      orderId: order?.id,
      chargeType: order ? 'paid' : 'unlimited',
      amount: order ? order.amount : 0,
    });

    if (order) {
      transitionServiceToCompleted(order.id);
    }

    res.json({
      ok: true,
      doc: { id: info.lastInsertRowid, download_url: `/api/docs/download/${info.lastInsertRowid}` },
      stats,
      // 引擎透明度：真实反映本次整篇改写使用的引擎（builtin=内置规则改写未调 AI，ai=大模型），
      // 由 docx-rewrite 按 runAI 同一口径判定后经 stats 回报
      engine: stats.usedRealAI ? 'ai' : 'builtin',
    });
  } catch (err) {
    if (order) {
      transitionServiceToFailed(order.id);
    }
    logger.error('tools', `文档改写失败: ${err.message}`);
    res.status(err.statusCode || 500).json({ error: '文档处理失败：' + err.message });
  }
}

// 整篇文档降重
router.post('/rewrite-doc', authRequired, aiToolLimiter, docUpload.single('file'), (req, res) => handleDocRewrite(req, res, 'rewrite'));
// 整篇文档降AI率
router.post('/ai-reduce-doc', authRequired, aiToolLimiter, docUpload.single('file'), (req, res) => handleDocRewrite(req, res, 'ai_reduce'));

export default router;

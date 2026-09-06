// AI 工具共享内核：计费执行（executeWithBilling）、材料注入、订单流转与统一文档生成器。
// 由 tools.js 聚合挂载；writing / research / utility / document 子路由复用此处能力。
import db from '../../db.js';
import { runAI } from '../../ai-service.js';
import { logUsage } from '../../usage.js';
import logger from '../../logger.js';
import { getFeaturePrice, getSetting } from '../../config-store.js';
import { isFreeUnlimitedFeature, materialFee, materialBillableTokens, MATERIAL_MAX_CHARS_PER, MATERIAL_TOTAL_CHARS_MAX } from '../../services/billing.js';
import { generateDocx } from '../../services/docx-generator.js';
import { saveTask, updateTaskResult, buildProjectContext, isProjectOwned, classifyTaskError, ensureAutoProject } from '../../services/task-store.js';
import { checkContent } from '../../services/content-safety.js';
import { claimOrderExecution } from '../../services/order-claim.js';
import { transitionServiceToFailed, transitionServiceToCompleted } from '../../services/order-state.js';

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
      params = { ...params, context: [ctx.context, params?.context].filter(Boolean).join('\n\n') };
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
      const { generatePptx, parseOutlineToSlides } = await import('../../services/pptx-generator.js');
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

// 子路由复用的共享能力
export {
  MAX_INPUT_CHARS,
  MAX_TOPIC_CHARS,
  checkTextLen,
  hasAgreedAcademicIntegrity,
  resolveBilling,
  loadTemplate,
  runDocumentTool,
};

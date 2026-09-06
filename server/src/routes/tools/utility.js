// 纯文本工具路由：润色、中英翻译、语法纠错、参考文献格式化、论文降重、降AI率（单版本/多版本）。
// 挂载于 tools.js（/api/tools 前缀），共享 core 的计费执行。
import { Router } from 'express';
import { authRequired } from '../../middleware.js';
import { formatReference, rewriteText } from '../../ai.js';
import { logUsage } from '../../usage.js';
import logger from '../../logger.js';
import { getFeaturePrice } from '../../config-store.js';
import { saveTask } from '../../services/task-store.js';
import { checkCoherence, aiReduceVersions } from '../../services/text-optimize.js';
import { claimOrderExecution } from '../../services/order-claim.js';
import { transitionServiceToFailed, transitionServiceToCompleted } from '../../services/order-state.js';
import {
  executeWithBilling,
  checkTextLen,
  hasAgreedAcademicIntegrity,
  resolveBilling,
  MAX_INPUT_CHARS,
} from './core.js';

const router = Router();

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
      const { polishText } = await import('../../ai.js');
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
      const { grammarCheck } = await import('../../ai.js');
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

export default router;

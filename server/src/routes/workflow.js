// 完整论文工作流路由（阶段三升级）
import { Router } from 'express';
import { authRequired } from '../middleware.js';
import {
  createFullPaperWorkflow, getWorkflowState, confirmLiterature,
  saveOutlineValidated, confirmOutlineValidated, generateCurrentChapter,
  confirmChapter, backToChapter, runFinalCheck, generateFinalDocument, buildExpertContext,
} from '../services/workflow-service.js';
import { getFeaturePrice } from '../config-store.js';

const router = Router();

// 创建「生成完整论文」工作流（写入模式/初始状态 + 论文元信息）
router.post('/:id/start', authRequired, (req, res) => {
  const { title, field, degree, description, writingRequirements } = req.body || {};
  try {
    const wf = createFullPaperWorkflow(parseInt(req.params.id, 10), req.user.id, {
      title, field, degree, description, writingRequirements,
    });
    res.json({ ok: true, workflow: wf });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 查询工作流状态（前端步骤导航/进度恢复用）
router.get('/:id/state', authRequired, (req, res) => {
  const wf = getWorkflowState(parseInt(req.params.id, 10), req.user.id);
  if (!wf) return res.status(404).json({ error: '工作区不存在' });
  res.json({ workflow: wf });
});

// researching → outline_review：确认/保存真实文献，校验可溯源文献数
router.post('/:id/literature/confirm', authRequired, (req, res) => {
  const { references } = req.body || {};
  try {
    const wf = confirmLiterature(parseInt(req.params.id, 10), req.user.id, references);
    res.json({ ok: true, workflow: wf });
  } catch (err) {
    res.status(err.code === 'LITERATURE_INSUFFICIENT' ? 422 : 400).json({ error: err.message, code: err.code });
  }
});

// 保存并校验大纲（结构文本或结构化数组）；开题报告式结构会被拒绝
router.post('/:id/outline', authRequired, (req, res) => {
  const { outline, text, fromText, autoFix } = req.body || {};
  try {
    const p = saveOutlineValidated(parseInt(req.params.id, 10), req.user.id, fromText ? text : outline, { fromText, autoFix });
    res.json({ ok: true, project: p });
  } catch (err) {
    if (err.code === 'OUTLINE_INVALID') return res.status(422).json({ error: err.message, code: err.code, details: err.details });
    res.status(400).json({ error: err.message });
  }
});

// 确认大纲（强校验：必须为论文结构）
router.post('/:id/outline/confirm', authRequired, (req, res) => {
  try {
    const wf = confirmOutlineValidated(parseInt(req.params.id, 10), req.user.id);
    res.json({ ok: true, workflow: wf });
  } catch (err) {
    if (err.code === 'OUTLINE_INVALID') return res.status(422).json({ error: err.message, code: err.code, details: err.details });
    res.status(400).json({ error: err.message });
  }
});

// chapter_generating → chapter_review：生成当前章（单章）
router.post('/:id/chapters/current/generate', authRequired, async (req, res) => {
  const { orderNo } = req.body || {};
  try {
    const r = await generateCurrentChapter(req.user.id, parseInt(req.params.id, 10), orderNo);
    res.json(r);
  } catch (err) {
    if (err.needOrder) {
      const fp = getFeaturePrice(err.itemType || 'writing_fulltext');
      return res.status(402).json({ error: err.message, needOrder: true, itemType: err.itemType, amount: fp ? fp.price : 0 });
    }
    res.status(400).json({ error: err.message });
  }
});

// chapter_review：确认当前章 → 推进到下一章或 final_review
router.post('/:id/chapters/current/confirm', authRequired, (req, res) => {
  try {
    const wf = confirmChapter(req.user.id, parseInt(req.params.id, 10));
    res.json({ ok: true, workflow: wf });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 返回上一步（调整大纲/重写）
router.post('/:id/chapters/back', authRequired, (req, res) => {
  const { index } = req.body || {};
  try {
    const wf = backToChapter(req.user.id, parseInt(req.params.id, 10), index);
    res.json({ ok: true, workflow: wf });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// final_review：全文一致性检查
router.post('/:id/final-check', authRequired, (req, res) => {
  try {
    const result = runFinalCheck(parseInt(req.params.id, 10), req.user.id);
    res.json({ ok: true, check: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 生成最终文档（Word / 可选 Quarto 格式）
router.post('/:id/final-document', authRequired, async (req, res) => {
  try {
    const doc = await generateFinalDocument(req.user.id, parseInt(req.params.id, 10), req.body || {});
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 专家咨询上下文（前端据此构造 /app/courses?projectId=... 预填）
router.get('/:id/expert-consult', authRequired, (req, res) => {
  const ctx = buildExpertContext(parseInt(req.params.id, 10), req.user.id);
  if (!ctx) return res.status(404).json({ error: '工作区不存在' });
  const params = new URLSearchParams({
    projectId: String(ctx.projectId),
    title: ctx.title,
    field: ctx.field,
    degree: ctx.degree,
    writingRequirements: ctx.writingRequirements,
    completion: ctx.completion,
  });
  res.json({ ok: true, context: ctx, url: `/app/courses?${params.toString()}` });
});

export default router;

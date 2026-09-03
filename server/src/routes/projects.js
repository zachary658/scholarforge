// 论文工作区路由
import { Router } from 'express';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authRequired } from '../middleware.js';
import {
  createProject, getProject, listProjects, updateProject, deleteProject, deleteProjectForever,
  buildProjectContext, listTasks, getTaskDetail, deleteTask, confirmOutline, PAPER_STAGES,
} from '../services/task-store.js';
import {
  startChapterGeneration, regenerateChapter, editChapter, mergeChapters, isGenerating,
} from '../services/chapter-service.js';
import { confirmOutlineValidated } from '../services/workflow-service.js';
import { generateDocx } from '../services/docx-generator.js';
import { isQuartoConfigured, exportDocument } from '../services/quarto-exporter.js';
import { checkTextLength, TEXT_MAX_SHORT, TEXT_MAX_LONG } from '../utils.js';
import { evidenceQuality, rebuildProjectEvidence, searchProjectEvidenceHybrid } from '../services/evidence-engine.js';

const router = Router();

// ========== 论文工作区 CRUD ==========
router.get('/', authRequired, (req, res) => {
  res.json({ projects: listProjects(req.user.id) });
});

router.post('/', authRequired, (req, res) => {
  const { title, field, description, writingRequirements, outline, degree, deadline } = req.body || {};
  if (!title) return res.status(400).json({ error: '请填写论文标题' });
  // 入库长度校验：标题/领域/学历 ≤200，描述/写作要求 ≤5000，超限 400
  const lenErr = checkTextLength([
    { value: title, label: '论文标题', max: TEXT_MAX_SHORT },
    { value: field, label: '学科领域', max: TEXT_MAX_SHORT },
    { value: degree, label: '学历', max: TEXT_MAX_SHORT },
    { value: description, label: '论文描述', max: TEXT_MAX_LONG },
    { value: writingRequirements, label: '写作要求', max: TEXT_MAX_LONG },
  ]);
  if (lenErr) return res.status(400).json({ error: lenErr });
  // 截止时间：可选，须为合法时间戳（空值/非法值置空，不阻断创建）
  let safeDeadline = null;
  if (deadline) {
    const n = Number(deadline);
    safeDeadline = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  }
  const p = createProject({
    userId: req.user.id,
    title,
    field: field || '',
    description: description || '',
    writingRequirements: writingRequirements || '',
    outline: Array.isArray(outline) ? outline : [],
    degree: degree || '',
    deadline: safeDeadline,
  });
  res.json({ ok: true, project: p });
});

router.get('/:id', authRequired, (req, res) => {
  const p = getProject(parseInt(req.params.id, 10), req.user.id);
  if (!p) return res.status(404).json({ error: '工作区不存在' });
  res.json({ project: p });
});

router.put('/:id', authRequired, (req, res) => {
  const updates = { ...req.body };
  // 入库长度校验：标题/领域/学历 ≤200，描述/写作要求 ≤5000（兼容驼峰与下划线两种字段名），超限 400
  const lenErr = checkTextLength([
    { value: updates.title, label: '论文标题', max: TEXT_MAX_SHORT },
    { value: updates.field, label: '学科领域', max: TEXT_MAX_SHORT },
    { value: updates.degree, label: '学历', max: TEXT_MAX_SHORT },
    { value: updates.description, label: '论文描述', max: TEXT_MAX_LONG },
    { value: updates.writingRequirements ?? updates.writing_requirements, label: '写作要求', max: TEXT_MAX_LONG },
  ]);
  if (lenErr) return res.status(400).json({ error: lenErr });
  // 字段名映射
  if (updates.writingRequirements) {
    updates.writing_requirements = updates.writingRequirements;
    delete updates.writingRequirements;
  }
  // 截止时间：可选，须为合法时间戳（空值清空，非法值丢弃不更新）
  if ('deadline' in updates) {
    if (updates.deadline == null || updates.deadline === '') {
      updates.deadline = null;
    } else {
      const n = Number(updates.deadline);
      updates.deadline = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }
  }
  // 论文阶段白名单：current_stage 只允许 PAPER_STAGES 中的值（禁止客户端伪造任意阶段）
  if (updates.current_stage != null && !PAPER_STAGES.includes(updates.current_stage)) {
    return res.status(400).json({ error: '阶段不合法' });
  }
  // 完成度校验：0–100 整数，非法直接 400（不静默归零）
  if (updates.completion_percent != null) {
    const pct = Number(updates.completion_percent);
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
      return res.status(400).json({ error: '完成度必须在 0–100 之间' });
    }
  }
  if (updates.outline) {
    // 大纲更新校验：数组长度 ≤15（与生成侧硬上限一致），元素结构合法
    // （章对象须含 chapter/title 字符串标题，sections 为对象数组），防恶意构造超长大纲
    const outline = updates.outline;
    if (!Array.isArray(outline)) {
      return res.status(400).json({ error: '大纲格式不正确（应为章节数组）' });
    }
    if (outline.length > 15) {
      return res.status(400).json({ error: '章节数量超过上限（最多 15 章）' });
    }
    const structureOk = outline.every((ch) =>
      ch && typeof ch === 'object' && !Array.isArray(ch)
      && typeof (ch.chapter || ch.title) === 'string' && (ch.chapter || ch.title).trim().length > 0
      && (ch.sections === undefined || (Array.isArray(ch.sections)
        && ch.sections.every((s) => s && typeof s === 'object' && !Array.isArray(s)))));
    if (!structureOk) {
      return res.status(400).json({ error: '大纲章节结构不合法（每章需有标题，sections 为小节数组）' });
    }
    updates.outline_json = updates.outline;
    delete updates.outline;
  }
  const p = updateProject(parseInt(req.params.id, 10), req.user.id, updates);
  if (!p) return res.status(404).json({ error: '工作区不存在' });
  res.json({ ok: true, project: p });
});

router.delete('/:id', authRequired, (req, res) => {
  // hard=1 物理删除（级联材料/任务）；默认软删除（归档，保留关联记录）
  const hard = req.query.hard === '1' || req.query.hard === 'true';
  const id = parseInt(req.params.id, 10);
  const ok = hard ? deleteProjectForever(id, req.user.id) : deleteProject(id, req.user.id);
  if (!ok) return res.status(404).json({ error: '工作区不存在' });
  res.json({ ok: true, hard });
});

// 预览工作区上下文（前端展示给用户看会带入哪些上下文）
router.get('/:id/context-preview', authRequired, (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const p = getProject(projectId, req.user.id);
  if (!p) return res.status(404).json({ error: '工作区不存在' });
  const toolType = req.query.toolType || '';
  const action = req.query.action || '';
  const { context, summary } = buildProjectContext(projectId, req.user.id, { currentToolType: toolType, currentAction: action });
  res.json({ context, summary, chars: context.length });
});

// 项目证据库：返回质量评分与可追溯片段，供用户在生成前核对证据是否充分。
router.get('/:id/evidence', authRequired, async (req, res, next) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const p = getProject(projectId, req.user.id);
    if (!p) return res.status(404).json({ error: '工作区不存在' });
    const q = String(req.query.q || p.title || '').trim().slice(0, 500);
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 8));
    const search = await searchProjectEvidenceHybrid({ userId: req.user.id, projectId, query: q, limit });
    return res.json({ quality: evidenceQuality(req.user.id, projectId), query: q, ...search });
  } catch (err) {
    return next(err);
  }
});

// 为历史项目或更换检索模型后的项目重建证据索引。
router.post('/:id/evidence/rebuild', authRequired, (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const quality = rebuildProjectEvidence(req.user.id, projectId);
  if (!quality) return res.status(404).json({ error: '工作区不存在' });
  res.json({ ok: true, quality });
});

// ========== 工作区内任务历史 ==========
router.get('/:id/tasks', authRequired, (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const p = getProject(projectId, req.user.id);
  if (!p) return res.status(404).json({ error: '工作区不存在' });
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = Math.min(50, Math.max(10, parseInt(req.query.size) || 20));
  const toolType = req.query.toolType || null;
  const keyword = (req.query.q || '').toString().trim() || null;
  const result = listTasks({ userId: req.user.id, projectId, toolType, keyword, page, size });
  res.json(result);
});

// ========== 阶段三：大纲确认 + 分章节生成 ==========

// 确认大纲（全文生成前强制校验：拒绝开题报告式 / 非论文结构）
router.post('/:id/outline/confirm', authRequired, (req, res) => {
  try {
    const wf = confirmOutlineValidated(parseInt(req.params.id, 10), req.user.id);
    res.json({ ok: true, workflow: wf });
  } catch (err) {
    if (err.code === 'OUTLINE_INVALID') {
      return res.status(422).json({ error: err.message, code: err.code, details: err.details });
    }
    res.status(400).json({ error: err.message });
  }
});

// 获取章节草稿与生成状态
router.get('/:id/chapters', authRequired, (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const p = getProject(projectId, req.user.id);
  if (!p) return res.status(404).json({ error: '工作区不存在' });
  res.json({ chapters: p.chapters || [], outline_confirmed_at: p.outline_confirmed_at, generating: isGenerating(projectId) });
});

// 分章节生成（异步，进程内队列，前端轮询）
router.post('/:id/chapters/generate', authRequired, async (req, res) => {
  const { orderNo } = req.body || {};
  try {
    const result = await startChapterGeneration(req.user.id, parseInt(req.params.id, 10), orderNo);
    res.json(result);
  } catch (err) {
    if (err.needOrder) {
      // 携带金额，前端 FeaturePay 需要展示价格（此前前端硬编码 amount=0，展示 ¥0.00）
      const { getFeaturePrice } = await import('../config-store.js');
      const fp = getFeaturePrice(err.itemType || 'writing_fulltext');
      return res.status(402).json({ error: err.message, needOrder: true, itemType: err.itemType, amount: fp ? fp.price : 0 });
    }
    res.status(400).json({ error: err.message });
  }
});

// 重新生成某章
router.post('/:id/chapters/:chapterId/regenerate', authRequired, async (req, res) => {
  const { orderNo } = req.body || {};
  try {
    const result = await regenerateChapter(req.user.id, parseInt(req.params.id, 10), req.params.chapterId, orderNo);
    res.json(result);
  } catch (err) {
    if (err.needOrder) {
      const { getFeaturePrice } = await import('../config-store.js');
      const fp = getFeaturePrice(err.itemType || 'writing_fulltext');
      return res.status(402).json({ error: err.message, needOrder: true, itemType: err.itemType, amount: fp ? fp.price : 0 });
    }
    res.status(400).json({ error: err.message });
  }
});

// 编辑某章内容
router.put('/:id/chapters/:chapterId', authRequired, (req, res) => {
  try {
    const result = editChapter(req.user.id, parseInt(req.params.id, 10), req.params.chapterId, req.body?.content);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 合并全部章节导出 Word（可传 template_id 应用高校/自定义模板格式）
// 若配置了 Quarto/Pandoc 且请求带 format 参数，则走出版级导出（DOCX/PDF/LaTeX/HTML 等）；
// 否则回退既有 docx-generator 拼装链路。
router.post('/:id/chapters/merge', authRequired, async (req, res) => {
  try {
    const merged = mergeChapters(req.user.id, parseInt(req.params.id, 10));
    const requestedFormat = String(req.body?.format || '').toLowerCase().trim();

    // 出版级导出分支（可选插件，未配置时静默走下方既有链路）
    if (requestedFormat && isQuartoConfigured()) {
      const format = ['docx', 'pdf', 'latex', 'html', 'epub', 'pptx', 'odt'].includes(requestedFormat)
        ? requestedFormat
        : null;
      if (!format) return res.status(400).json({ error: `不支持的导出格式: ${requestedFormat}` });
      const inputPath = join(tmpdir(), `sf-chapters-${req.params.id}-${Date.now()}.md`);
      const outputPath = join(tmpdir(), `sf-chapters-${req.params.id}-${Date.now()}.${format}`);
      writeFileSync(inputPath, merged.content, 'utf8');
      const result = await exportDocument(inputPath, outputPath, { format });
      return res.json({ quarto: result, content: merged.content });
    }

    // 模板可选：与写作类导出一致，限本人上传或全局共享的模板
    let template = null;
    const templateId = parseInt(req.body?.template_id, 10);
    if (templateId) {
      const { default: db } = await import('../db.js');
      template = db.prepare('SELECT * FROM templates WHERE id = ? AND (user_id = ? OR is_global = 1)').get(templateId, req.user.id);
    }
    const doc = await generateDocx({
      title: merged.title,
      content: merged.content,
      feature: 'chapters',
      userId: req.user.id,
      projectId: parseInt(req.params.id, 10),
      template,
    });
    res.json({ doc, content: merged.content });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;

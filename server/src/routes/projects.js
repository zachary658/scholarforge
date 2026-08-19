// 论文工作区路由
import { Router } from 'express';
import { authRequired } from '../middleware.js';
import {
  createProject, getProject, listProjects, updateProject, deleteProject,
  buildProjectContext, listTasks, getTaskDetail, deleteTask, confirmOutline,
} from '../services/task-store.js';
import {
  startChapterGeneration, regenerateChapter, editChapter, mergeChapters, isGenerating,
} from '../services/chapter-service.js';
import { generateDocx } from '../services/docx-generator.js';

const router = Router();

// ========== 论文工作区 CRUD ==========
router.get('/', authRequired, (req, res) => {
  res.json({ projects: listProjects(req.user.id) });
});

router.post('/', authRequired, (req, res) => {
  const { title, field, description, writingRequirements, outline } = req.body || {};
  if (!title) return res.status(400).json({ error: '请填写论文标题' });
  const p = createProject({
    userId: req.user.id,
    title,
    field: field || '',
    description: description || '',
    writingRequirements: writingRequirements || '',
    outline: Array.isArray(outline) ? outline : [],
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
  // 字段名映射
  if (updates.writingRequirements) {
    updates.writing_requirements = updates.writingRequirements;
    delete updates.writingRequirements;
  }
  if (updates.outline) {
    updates.outline_json = updates.outline;
    delete updates.outline;
  }
  const p = updateProject(parseInt(req.params.id, 10), req.user.id, updates);
  if (!p) return res.status(404).json({ error: '工作区不存在' });
  res.json({ ok: true, project: p });
});

router.delete('/:id', authRequired, (req, res) => {
  const ok = deleteProject(parseInt(req.params.id, 10), req.user.id);
  if (!ok) return res.status(404).json({ error: '工作区不存在' });
  res.json({ ok: true });
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

// 确认大纲（全文生成前强制校验）
router.post('/:id/outline/confirm', authRequired, (req, res) => {
  const p = confirmOutline(parseInt(req.params.id, 10), req.user.id);
  if (!p) return res.status(404).json({ error: '工作区不存在' });
  res.json({ ok: true, project: p });
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
    if (err.needOrder) return res.status(402).json({ error: err.message, needOrder: true, itemType: err.itemType });
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

// 合并全部章节导出 Word
router.post('/:id/chapters/merge', authRequired, async (req, res) => {
  try {
    const merged = mergeChapters(req.user.id, parseInt(req.params.id, 10));
    const doc = await generateDocx({
      title: merged.title,
      content: merged.content,
      feature: 'chapters',
      userId: req.user.id,
    });
    res.json({ doc, content: merged.content });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;

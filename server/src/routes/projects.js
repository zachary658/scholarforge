// 论文工作区路由
import { Router } from 'express';
import { authRequired } from '../middleware.js';
import {
  createProject, getProject, listProjects, updateProject, deleteProject,
  buildProjectContext, listTasks, getTaskDetail, deleteTask,
} from '../services/task-store.js';

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

export default router;

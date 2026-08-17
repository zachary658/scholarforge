// AI 任务历史路由（跨工作区的全局任务列表）
import { Router } from 'express';
import { authRequired } from '../middleware.js';
import { listTasks, getTaskDetail, deleteTask } from '../services/task-store.js';

const router = Router();

// 任务列表（支持按工作区/工具/关键词筛选）
router.get('/', authRequired, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = Math.min(50, Math.max(10, parseInt(req.query.size) || 20));
  const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
  const toolType = req.query.toolType || null;
  const keyword = (req.query.q || '').toString().trim() || null;
  const result = listTasks({ userId: req.user.id, projectId, toolType, keyword, page, size });
  res.json(result);
});

// 任务详情
router.get('/:id', authRequired, (req, res) => {
  const task = getTaskDetail(parseInt(req.params.id, 10), req.user.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  res.json({ task });
});

// 删除任务
router.delete('/:id', authRequired, (req, res) => {
  const ok = deleteTask(parseInt(req.params.id, 10), req.user.id);
  if (!ok) return res.status(404).json({ error: '任务不存在' });
  res.json({ ok: true });
});

export default router;

// AI 任务历史路由（跨工作区的全局任务列表）+ 失败任务一键重试
import { Router } from 'express';
import { authRequired } from '../middleware.js';
import { listTasks, getTaskDetail, deleteTask, prepareTaskRetry, updateTaskResult } from '../services/task-store.js';
import { executeWithBilling } from './tools.js';
import { claimOrderExecution } from '../services/order-claim.js';
import db from '../db.js';
import logger from '../logger.js';

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

// 从任务记录恢复「重新执行」所需配置（featureKey + 文档标题）
function taskRetryConfig(task) {
  const p = task.params || {};
  const topic = String(p.topic || p.title || '');
  const cfg = { featureKey: task.tool_type, action: task.action, generateDocxOptions: null, generatePptxOptions: null };
  switch (task.tool_type) {
    case 'writing':
      cfg.featureKey = `writing_${task.action}`;
      cfg.generateDocxOptions = { title: topic || '未命名论文', template: null };
      break;
    case 'proposal':
      cfg.generateDocxOptions = { title: topic ? `${topic}开题报告` : '开题报告', template: null };
      break;
    case 'literature_review':
      cfg.generateDocxOptions = { title: topic ? `${topic}文献综述` : '文献综述', template: null };
      break;
    case 'task_book':
      cfg.generateDocxOptions = { title: topic ? `${topic}任务书` : '任务书', template: null };
      break;
    case 'defense':
      cfg.generatePptxOptions = { title: topic ? `${topic}答辩PPT` : '答辩PPT' };
      break;
    case 'journal':
      cfg.generateDocxOptions = { title: topic || '期刊论文', template: null };
      break;
    default:
      // 文本优化类（rewrite/ai_reduce/polish/translate/grammar）无需生成文档
      break;
  }
  return cfg;
}

// 失败任务一键重试：原子抢占 → 后台执行 → 立即返回 202，前端轮询任务状态。
// 恢复原输入与参数、沿用原订单（不创建新订单、不重复扣费），不阻塞 HTTP 连接。
router.post('/:id/retry', authRequired, async (req, res) => {
  const taskId = parseInt(req.params.id, 10);
  const { task, orderNo, error, status } = prepareTaskRetry(taskId, req.user.id);
  if (error) return res.status(status || 400).json({ error });

  // 原子抢占订单执行权（failed → processing），防止并发重复重试同一订单
  if (orderNo) {
    const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo);
    if (order && !claimOrderExecution(order)) {
      return res.status(409).json({ error: '订单正在处理中，请勿重复提交' });
    }
  }
  // 标记任务为处理中（progress 归 0，前端据此展示「处理中」）
  updateTaskResult(taskId, req.user.id, { status: 'processing', progress: 0, stage: 'retrying', errorCode: null });

  const cfg = taskRetryConfig(task);

  // 后台执行：不 await，立即返回 202；前端通过 GET /tasks/:id 轮询 status 直到 success/failed。
  executeWithBilling({
    userId: req.user.id,
    featureKey: cfg.featureKey,
    toolType: task.tool_type,
    action: cfg.action,
    params: { ...task.params },
    projectId: task.project_id || null,
    inputText: task.input_text || '',
    generateDocxOptions: cfg.generateDocxOptions,
    generatePptxOptions: cfg.generatePptxOptions,
    orderNo: orderNo || null,
    existingTaskId: taskId,
    skipClaim: true, // 已在上方原子抢占，避免二次抢占冲突
  }).catch((err) => {
    logger.error('tasks', `retry background failed: ${err.message}`);
  });

  return res.status(202).json({ taskId, status: 'processing', orderNo: orderNo || null });
});

export default router;

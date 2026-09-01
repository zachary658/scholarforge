// AI 任务历史路由（跨工作区的全局任务列表）+ 失败任务一键重试
import { Router } from 'express';
import { authRequired } from '../middleware.js';
import { listTasks, getTaskDetail, deleteTask, prepareTaskRetry } from '../services/task-store.js';
import { executeWithBilling } from './tools.js';

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

// 失败任务一键重试：恢复原输入与参数 → 沿用原订单重新执行（不创建新订单、不重复扣费）
router.post('/:id/retry', authRequired, async (req, res) => {
  const taskId = parseInt(req.params.id, 10);
  const { task, orderNo, error, status } = prepareTaskRetry(taskId, req.user.id);
  if (error) return res.status(status || 400).json({ error });

  const cfg = taskRetryConfig(task);
  try {
    const result = await executeWithBilling({
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
    });
    if (result.needOrder) return res.json({ ...result });
    res.json({
      ok: true,
      content: result.content,
      doc: result.doc,
      taskId: result.taskId,
      orderNo: result.orderNo,
      projectId: result.projectId,
      model: result.model,
      tokens: result.tokens,
      retention_days: result.retention_days,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: '重试失败：' + err.message });
  }
});

export default router;

// 用户订单路由
import { Router } from 'express';
import { authRequired } from '../middleware.js';
import db from '../db.js';

const router = Router();

// 我的订单列表
router.get('/', authRequired, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = Math.min(50, Math.max(10, parseInt(req.query.size) || 20));
  const status = (req.query.status || '').toString();
  const type = (req.query.type || '').toString();
  const offset = (page - 1) * size;
  let where = 'WHERE user_id = ?';
  const params = [req.user.id];
  if (status) { where += ' AND status = ?'; params.push(status); }
  if (type) { where += ' AND type = ?'; params.push(type); }
  const total = db.prepare(`SELECT COUNT(*) as c FROM orders ${where}`).get(...params).c;
  const orders = db.prepare(
    `SELECT * FROM orders ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...params, size, offset);
  res.json({
    orders: orders.map((o) => ({
      ...o,
      metadata: undefined,
      transaction_id: undefined,
      refund_reason: undefined,
    })),
    total, page, size, pages: Math.ceil(total / size),
  });
});

// 订单详情
router.get('/:orderNo', authRequired, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE order_no = ? AND user_id = ?').get(req.params.orderNo, req.user.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  let meta = {};
  try { meta = JSON.parse(order.metadata || '{}'); } catch { meta = {}; }
  res.json({
    ...order,
    metadata: undefined,
    transaction_id: undefined,
    refund_reason: undefined,
    executed: !!meta.executed,
    doc_id: meta.doc_id || null,
    result_preview: meta.result_preview || null,
    result_content: meta.result_content || null,
  });
});

export default router;

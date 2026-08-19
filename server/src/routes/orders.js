// 用户订单路由（现金直付：功能固定价 + 人工报价）
import { Router } from 'express';
import { authRequired } from '../middleware.js';
import db from '../db.js';
import { createFeatureOrder, requestQuoteOrder, initiateOrderPayment } from '../services/payment.js';

const router = Router();

// 固定价格功能订单
router.post('/', authRequired, (req, res) => {
  const { item_type, quantity, payment_method, params } = req.body || {};
  if (!item_type) return res.status(400).json({ error: '请指定功能类型' });
  try {
    const result = createFeatureOrder({
      userId: req.user.id,
      itemType: item_type,
      quantity: quantity || 1,
      paymentMethod: payment_method || null,
      params: params || null,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 动态报价订单
router.post('/request-quote', authRequired, (req, res) => {
  const { item_type, custom_requirements, expected_deadline } = req.body || {};
  if (!item_type) return res.status(400).json({ error: '请指定功能类型' });
  if (!custom_requirements) return res.status(400).json({ error: '请填写自定义需求' });
  try {
    const result = requestQuoteOrder({
      userId: req.user.id,
      itemType: item_type,
      customRequirements: custom_requirements,
      expectedDeadline: expected_deadline || null,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 已报价订单：接受并支付
router.post('/:orderNo/pay', authRequired, (req, res) => {
  const { payment_method } = req.body || {};
  const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(req.params.orderNo);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  if (order.user_id !== req.user.id) return res.status(403).json({ error: '无权操作此订单' });
  try {
    const result = initiateOrderPayment(order.order_no, payment_method || null);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 我的订单列表
router.get('/', authRequired, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = Math.min(50, Math.max(10, parseInt(req.query.size) || 20));
  const status = (req.query.status || '').toString();
  const offset = (page - 1) * size;
  let where = 'WHERE user_id = ?';
  const params = [req.user.id];
  if (status) { where += ' AND status = ?'; params.push(status); }
  const total = db.prepare(`SELECT COUNT(*) as c FROM orders ${where}`).get(...params).c;
  const orders = db.prepare(
    `SELECT * FROM orders ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...params, size, offset);
  res.json({
    orders: orders.map(sanitizeOrder),
    total, page, size, pages: Math.ceil(total / size),
  });
});

// 订单详情
router.get('/:orderNo', authRequired, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE order_no = ? AND user_id = ?').get(req.params.orderNo, req.user.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  res.json(sanitizeOrder(order));
});

// 脱敏：不向用户暴露交易流水号等内部字段
function sanitizeOrder(o) {
  return {
    ...o,
    transaction_id: undefined,
    metadata: undefined,
  };
}

export default router;

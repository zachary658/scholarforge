// 用户订单路由（现金直付：功能固定价 + 人工报价）
import { Router } from 'express';
import { authRequired } from '../middleware.js';
import { paymentLimiter } from '../middleware/rateLimit.js';
import db from '../db.js';
import { createFeatureOrder, requestQuoteOrder, initiateOrderPayment } from '../services/payment.js';
import { checkTextLength, TEXT_MAX_SHORT, TEXT_MAX_LONG } from '../utils.js';

const router = Router();

// 订单 / 支付动作限流：每用户每分钟最多 30 次（M-2）
router.use((req, res, next) => {
  if (req.method === 'POST') return paymentLimiter(req, res, next);
  next();
});

// 固定价格功能订单
router.post('/', authRequired, (req, res) => {
  const { item_type, quantity, payment_method, params, material_ids } = req.body || {};
  if (!item_type) return res.status(400).json({ error: '请指定功能类型' });
  try {
    const result = createFeatureOrder({
      userId: req.user.id,
      itemType: item_type,
      quantity: quantity || 1,
      paymentMethod: payment_method || null,
      params: params || null,
      materialIdsParam: material_ids || null,
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
  // 入库长度校验：需求描述 ≤5000，期望交付时间说明 ≤200，超限 400
  const lenErr = checkTextLength([
    { value: custom_requirements, label: '自定义需求', max: TEXT_MAX_LONG },
    { value: expected_deadline, label: '期望交付时间', max: TEXT_MAX_SHORT },
  ]);
  if (lenErr) return res.status(400).json({ error: lenErr });
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
  const afterSales = orders.length ? db.prepare(
    `SELECT * FROM after_sales_requests WHERE order_id IN (${orders.map(() => '?').join(',')}) ORDER BY id DESC`
  ).all(...orders.map((order) => order.id)) : [];
  const latestByOrder = new Map();
  for (const item of afterSales) if (!latestByOrder.has(item.order_id)) latestByOrder.set(item.order_id, item);
  res.json({
    orders: orders.map((order) => ({ ...sanitizeOrder(order), after_sales: latestByOrder.get(order.id) || null })),
    total, page, size, pages: Math.ceil(total / size),
  });
});

// 订单详情
router.get('/:orderNo', authRequired, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE order_no = ? AND user_id = ?').get(req.params.orderNo, req.user.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  const afterSales = db.prepare('SELECT * FROM after_sales_requests WHERE order_id=? ORDER BY id DESC').all(order.id);
  res.json({ ...sanitizeOrder(order), after_sales: afterSales });
});

router.post('/:orderNo/after-sales', authRequired, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE order_no=? AND user_id=?').get(req.params.orderNo, req.user.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  const requestType = String(req.body?.request_type || 'technical_failure');
  const reason = String(req.body?.reason || '').trim().slice(0, 2000);
  if (!['cancel', 'refund', 'technical_failure'].includes(requestType)) return res.status(400).json({ error: '售后类型无效' });
  if (!reason) return res.status(400).json({ error: '请说明售后原因' });
  if (requestType === 'cancel' && !['pending', 'quoted', 'awaiting_quote'].includes(order.status)) return res.status(409).json({ error: '已支付订单不能按未开始取消，请选择退款或技术故障' });
  if (requestType !== 'cancel' && !['paid', 'processing', 'completed'].includes(order.status)) return res.status(409).json({ error: '该订单尚未支付，无需申请退款' });
  try {
    const info = db.prepare(
      `INSERT INTO after_sales_requests (order_id,user_id,request_type,reason,requested_amount_cents)
       VALUES (?,?,?,?,?)`
    ).run(order.id, req.user.id, requestType, reason, Math.round(Number(order.amount || 0) * 100));
    res.json({ ok: true, id: info.lastInsertRowid, message: '售后申请已提交，处理结果会在订单中更新' });
  } catch (err) {
    if (/UNIQUE constraint/i.test(err.message || '')) return res.status(409).json({ error: '该订单已有处理中售后申请' });
    throw err;
  }
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

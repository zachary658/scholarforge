// 专利申请服务路由：服务介绍 / 提交需求 / 我的订单 / 发起支付
import { Router } from 'express';
import { authRequired } from '../middleware.js';
import db from '../db.js';
import { createOrder } from '../services/payment.js';

const router = Router();

// 专利类型（前台展示）
const PATENT_TYPES = [
  { key: 'invention', label: '发明专利', desc: '产品、方法或其改进所提出的新技术方案，含实质审查', icon: 'bulb' },
  { key: 'utility', label: '实用新型', desc: '产品的形状、构造或其结合所提出的适于实用的新技术方案', icon: 'gear' },
  { key: 'design', label: '外观设计', desc: '产品整体或局部的形状、图案、色彩及其结合的设计', icon: 'palette' },
];

// 服务介绍（公开）
router.get('/', (req, res) => {
  res.json({ patent_types: PATENT_TYPES });
});

// 我的专利服务订单
router.get('/my/orders', authRequired, (req, res) => {
  const rows = db.prepare(
    `SELECT po.id, po.patent_type, po.title, po.tech_description, po.contact, po.status, po.contact_status,
            po.quoted_price, po.quote_status, po.created_at,
            o.order_no, o.amount
     FROM patent_orders po
     LEFT JOIN orders o ON o.id = po.order_id
     WHERE po.user_id = ?
     ORDER BY po.id DESC`
  ).all(req.user.id);
  res.json({ orders: rows });
});

// 提交专利申请需求（生成待对接订单，客服报价 → 管理员审批 → 用户支付）
router.post('/orders', authRequired, (req, res) => {
  const { patent_type, title, tech_description, contact } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: '请填写发明/设计名称' });
  if (!PATENT_TYPES.some((t) => t.key === patent_type)) return res.status(400).json({ error: '请选择专利类型' });
  const td = String(tech_description || '').trim().slice(0, 5000);
  if (!td) return res.status(400).json({ error: '请填写技术方案描述' });

  // 去重：同一用户已有未完成（pending/contacted）的相同标题订单时拒绝重复提交
  const existing = db.prepare(
    "SELECT id FROM patent_orders WHERE user_id = ? AND title = ? AND status IN ('pending', 'contacted')"
  ).get(req.user.id, String(title).trim());
  if (existing) return res.status(409).json({ error: '该名称的专利申请已有待处理订单，请勿重复提交' });

  const info = db.prepare(
    `INSERT INTO patent_orders (user_id, patent_type, title, tech_description, contact, status, contact_status)
     VALUES (?, ?, ?, ?, ?, 'pending', 'pending')`
  ).run(req.user.id, patent_type, String(title).trim(), td, String(contact || '').trim().slice(0, 200));
  res.json({ ok: true, id: info.lastInsertRowid });
});

// 对已审批报价的专利订单发起支付
router.post('/orders/:id/pay', authRequired, (req, res) => {
  const po = db.prepare('SELECT id, user_id, status FROM patent_orders WHERE id = ?').get(req.params.id);
  if (!po) return res.status(404).json({ error: '订单不存在' });
  if (po.user_id !== req.user.id) return res.status(403).json({ error: '无权操作该订单' });
  try {
    const result = createOrder({ userId: req.user.id, type: 'patent', target: String(po.id) });
    res.json(result); // { order, payParams }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;

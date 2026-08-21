// 期刊论文发表服务路由：服务介绍 / 提交需求 / 我的订单 / 发起支付
import { Router } from 'express';
import { authRequired } from '../middleware.js';
import db from '../db.js';
import { createOrder } from '../services/payment.js';

const router = Router();

// 期刊级别（前台展示）
const JOURNAL_LEVELS = [
  { key: 'general', label: '普通期刊（普刊）', desc: '省级/国家级普刊，见刊周期较短' },
  { key: 'core', label: '核心期刊', desc: '北大核心 / CSSCI / CSCD 等，审稿周期较长' },
  { key: 'sci', label: 'SCI / EI 期刊', desc: '国际期刊，含英文润色与投稿辅助' },
];

// 服务介绍（公开）
router.get('/', (req, res) => {
  res.json({ journal_levels: JOURNAL_LEVELS });
});

// 我的发表服务订单
router.get('/my/orders', authRequired, (req, res) => {
  const rows = db.prepare(
    `SELECT pu.id, pu.paper_title, pu.field, pu.journal_level, pu.requirements, pu.contact, pu.status, pu.contact_status,
            pu.quoted_price, pu.quote_status, pu.created_at,
            o.order_no, o.amount
     FROM publication_orders pu
     LEFT JOIN orders o ON o.id = pu.order_id
     WHERE pu.user_id = ?
     ORDER BY pu.id DESC`
  ).all(req.user.id);
  res.json({ orders: rows });
});

// 提交期刊发表需求
router.post('/orders', authRequired, (req, res) => {
  const { paper_title, field, journal_level, requirements, contact } = req.body || {};
  if (!paper_title || !String(paper_title).trim()) return res.status(400).json({ error: '请填写论文标题' });
  if (!JOURNAL_LEVELS.some((l) => l.key === journal_level)) return res.status(400).json({ error: '请选择目标期刊级别' });

  // 去重：同一用户已有未完成的相同标题订单时拒绝重复提交
  const existing = db.prepare(
    "SELECT id FROM publication_orders WHERE user_id = ? AND paper_title = ? AND status IN ('pending', 'contacted')"
  ).get(req.user.id, String(paper_title).trim());
  if (existing) return res.status(409).json({ error: '该论文已有待处理的发表服务订单，请勿重复提交' });

  const info = db.prepare(
    `INSERT INTO publication_orders (user_id, paper_title, field, journal_level, requirements, contact, status, contact_status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 'pending')`
  ).run(
    req.user.id, String(paper_title).trim(), String(field || '').trim().slice(0, 100), journal_level,
    String(requirements || '').trim().slice(0, 3000), String(contact || '').trim().slice(0, 200)
  );
  res.json({ ok: true, id: info.lastInsertRowid });
});

// 对已审批报价的发表订单发起支付
router.post('/orders/:id/pay', authRequired, (req, res) => {
  const po = db.prepare('SELECT id, user_id, status FROM publication_orders WHERE id = ?').get(req.params.id);
  if (!po) return res.status(404).json({ error: '订单不存在' });
  if (po.user_id !== req.user.id) return res.status(403).json({ error: '无权操作该订单' });
  try {
    const result = createOrder({ userId: req.user.id, type: 'publication', target: String(po.id) });
    res.json(result); // { order, payParams }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;

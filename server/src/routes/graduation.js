// 毕业作品指导制作路由
import { Router } from 'express';
import { authRequired } from '../middleware.js';
import db from '../db.js';
import { createOrder } from '../services/payment.js';

const router = Router();

// 分类列表（预定义，供前端展示分组）
const CATEGORIES = [
  { key: '建筑图纸', label: '建筑图纸', desc: '建筑方案设计、结构施工图绘制', icon: 'building' },
  { key: '机械图纸', label: '机械图纸', desc: '机械零件设计、传动系统与制图', icon: 'gear' },
  { key: '仿真模拟', label: '仿真模拟', desc: 'MATLAB/ANSYS/Fluent 仿真分析', icon: 'simulation' },
  { key: '计算机程序', label: '计算机程序', desc: 'Web/App 开发、算法与数据分析', icon: 'code' },
  { key: 'PLC设计', label: 'PLC设计', desc: 'PLC 控制系统与生产线自动化', icon: 'plc' },
  { key: '其他', label: '其他', desc: '电子电路、嵌入式系统等', icon: 'other' },
];

// 可订购项目列表（仅上架，按分类+排序）—— 公开访问
router.get('/', (req, res) => {
  const projects = db.prepare(
    'SELECT * FROM graduation_projects WHERE is_active = 1 ORDER BY sort_order, id'
  ).all();
  res.json({
    categories: CATEGORIES,
    projects: projects.map((p) => ({ ...p, purchased: false })),
  });
});

// 项目详情
router.get('/:id', authRequired, (req, res) => {
  const project = db.prepare('SELECT * FROM graduation_projects WHERE id = ? AND is_active = 1').get(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在或已下架' });
  res.json({ project });
});

// 我的已购毕业作品订单
router.get('/my/orders', authRequired, (req, res) => {
  const rows = db.prepare(
    `SELECT gpo.id, gpo.status, gpo.contact_status, gpo.purchased_at, gpo.expires_at, gpo.requirements, gpo.quoted_price,
            gp.id AS project_id, gp.title AS project_title, gp.category, gp.description AS project_description, gp.duration_text,
            o.order_no, o.amount
     FROM graduation_project_orders gpo
     JOIN graduation_projects gp ON gp.id = gpo.project_id
     LEFT JOIN orders o ON o.id = gpo.order_id
     WHERE gpo.user_id = ?
     ORDER BY gpo.id DESC`
  ).all(req.user.id);
  const orders = rows.map((r) => {
    let requirements = null;
    try { requirements = r.requirements ? JSON.parse(r.requirements) : null; } catch { requirements = null; }
    return { ...r, requirements };
  });
  res.json({ orders });
});

// 提交定制需求（生成待对接订单，客服后台可见后跟进报价）
router.post('/orders', authRequired, (req, res) => {
  const { project_id, requirements } = req.body || {};
  const projectId = Number(project_id);
  if (!projectId) return res.status(400).json({ error: '请选择要定制的项目' });

  const project = db.prepare('SELECT * FROM graduation_projects WHERE id = ? AND is_active = 1').get(projectId);
  if (!project) return res.status(404).json({ error: '项目不存在或已下架' });

  // 去重：同一用户同一项目已有未完成（pending/contacted）订单时，拒绝重复提交，防止刷客服队列
  const existing = db.prepare(
    "SELECT id FROM graduation_project_orders WHERE user_id = ? AND project_id = ? AND status IN ('pending', 'contacted')"
  ).get(req.user.id, projectId);
  if (existing) return res.status(409).json({ error: '该项目已有待处理的定制订单，请勿重复提交' });

  // 规范化需求备注与联系方式
  const reqObj = {};
  if (requirements && typeof requirements === 'object') {
    if (requirements.remark) reqObj.remark = String(requirements.remark).trim().slice(0, 2000);
    if (requirements.contact) reqObj.contact = String(requirements.contact).trim().slice(0, 200);
  } else if (typeof requirements === 'string' && requirements.trim()) {
    reqObj.remark = requirements.trim().slice(0, 2000);
  }

  const info = db.prepare(
    `INSERT INTO graduation_project_orders (user_id, project_id, requirements, status, contact_status)
     VALUES (?, ?, ?, 'pending', 'pending')`
  ).run(req.user.id, projectId, JSON.stringify(reqObj));

  res.json({ ok: true, id: info.lastInsertRowid });
});

// 用户对已报价的毕业作品订单发起支付（生成可支付 orders 记录并返回支付参数）
router.post('/orders/:id/pay', authRequired, (req, res) => {
  const gpOrder = db.prepare(
    'SELECT id, user_id, quoted_price, status FROM graduation_project_orders WHERE id = ?'
  ).get(req.params.id);
  if (!gpOrder) return res.status(404).json({ error: '订单不存在' });
  if (gpOrder.user_id !== req.user.id) return res.status(403).json({ error: '无权操作该订单' });
  try {
    const result = createOrder({ userId: req.user.id, type: 'graduation', target: String(gpOrder.id) });
    res.json(result); // { order, payParams }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
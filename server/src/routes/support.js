// 客服路由：课程对接管理（admin 或 support 角色可访问）
import { Router } from 'express';
import { supportRequired } from '../middleware.js';
import db from '../db.js';
import { closePendingGraduationOrders } from '../services/payment.js';

const router = Router();

// 所有客服路由需要 support 或 admin 权限
router.use(supportRequired);

// ========== 课程对接管理（查看已支付课程订单 + 需求 + 标记对接状态） ==========
router.get('/course-orders', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = Math.min(100, Math.max(10, parseInt(req.query.size) || 20));
  const status = (req.query.status || '').toString();
  const q = (req.query.q || '').toString().trim();
  const offset = (page - 1) * size;
  let where = 'WHERE 1=1';
  const params = [];
  if (['pending', 'contacted', 'completed'].includes(status)) {
    where += ' AND uc.contact_status = ?';
    params.push(status);
  }
  if (q) {
    where += ' AND (u.email LIKE ? OR u.name LIKE ? OR c.title LIKE ? OR o.order_no LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  const total = db.prepare(
    `SELECT COUNT(*) as c FROM user_courses uc JOIN users u ON u.id = uc.user_id JOIN courses c ON c.id = uc.course_id ${where}`
  ).get(...params).c;
  const rows = db.prepare(
    `SELECT uc.id, uc.contact_status, uc.purchased_at, uc.expires_at, uc.requirements,
            u.name AS user_name, u.email AS user_email,
            c.title AS course_title, c.degree,
            o.order_no, o.amount
     FROM user_courses uc
     JOIN users u ON u.id = uc.user_id
     JOIN courses c ON c.id = uc.course_id
     LEFT JOIN orders o ON o.id = uc.order_id
     ${where}
     ORDER BY uc.id DESC LIMIT ? OFFSET ?`
  ).all(...params, size, offset);
  const items = rows.map((r) => {
    let requirements = null;
    try { requirements = r.requirements ? JSON.parse(r.requirements) : null; } catch { requirements = null; }
    return { ...r, requirements };
  });
  res.json({ items, total, page, size, pages: Math.ceil(total / size) });
});

router.put('/course-orders/:id/contact-status', (req, res) => {
  const { status } = req.body || {};
  if (!['pending', 'contacted', 'completed'].includes(status)) return res.status(400).json({ error: '无效的对接状态' });
  const row = db.prepare('SELECT id FROM user_courses WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '课程订单不存在' });
  db.prepare('UPDATE user_courses SET contact_status = ? WHERE id = ?').run(status, row.id);
  res.json({ ok: true, id: row.id, contact_status: status });
});

// ========== 课程列表（只读，供客服查看） ==========
router.get('/courses', (_req, res) => {
  const courses = db.prepare(
    'SELECT id, title, description, price, duration_text, degree, validity_days, is_active, sort_order FROM courses ORDER BY sort_order, id'
  ).all();
  res.json({ courses: courses.map((c) => ({ ...c, is_active: !!c.is_active })) });
});

// ========== 课程对接统计概览 ==========
router.get('/overview', (_req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayTs = Math.floor(todayStart.getTime() / 1000);
  const overdueTs = now - 24 * 3600;

  const pending = db.prepare("SELECT COUNT(*) as c FROM user_courses WHERE contact_status = 'pending'").get().c;
  const contacted = db.prepare("SELECT COUNT(*) as c FROM user_courses WHERE contact_status = 'contacted'").get().c;
  const completed = db.prepare("SELECT COUNT(*) as c FROM user_courses WHERE contact_status = 'completed'").get().c;
  const total = db.prepare('SELECT COUNT(*) as c FROM user_courses').get().c;
  // 毕业作品订单统计
  const gpPending = db.prepare("SELECT COUNT(*) as c FROM graduation_project_orders WHERE contact_status = 'pending'").get().c;
  const gpContacted = db.prepare("SELECT COUNT(*) as c FROM graduation_project_orders WHERE contact_status = 'contacted'").get().c;
  const gpCompleted = db.prepare("SELECT COUNT(*) as c FROM graduation_project_orders WHERE contact_status = 'completed'").get().c;
  const gpTotal = db.prepare('SELECT COUNT(*) as c FROM graduation_project_orders').get().c;

  // 今日新增订单
  const courseToday = db.prepare('SELECT COUNT(*) as c FROM user_courses WHERE purchased_at >= ?').get(todayTs).c;
  const gpToday = db.prepare('SELECT COUNT(*) as c FROM graduation_project_orders WHERE purchased_at >= ?').get(todayTs).c;
  // 待审批报价（客服提交，待管理员审批）
  const gpQuotePending = db.prepare("SELECT COUNT(*) as c FROM graduation_project_orders WHERE quote_status = 'pending'").get().c;
  // 超时未处理（待对接超过 24 小时）
  const courseOverdue = db.prepare("SELECT COUNT(*) as c FROM user_courses WHERE contact_status = 'pending' AND purchased_at < ?").get(overdueTs).c;
  const gpOverdue = db.prepare("SELECT COUNT(*) as c FROM graduation_project_orders WHERE contact_status = 'pending' AND purchased_at < ?").get(overdueTs).c;

  // 功能订单（现金直付）统计：待报价订单数、今日新增订单
  const featureAwaitingQuote = db.prepare("SELECT COUNT(*) as c FROM orders WHERE type = 'feature' AND status = 'awaiting_quote'").get().c;
  const featureToday = db.prepare("SELECT COUNT(*) as c FROM orders WHERE type = 'feature' AND created_at >= ?").get(todayTs).c;

  res.json({ pending, contacted, completed, total, gpPending, gpContacted, gpCompleted, gpTotal, courseToday, gpToday, gpQuotePending, courseOverdue, gpOverdue, featureAwaitingQuote, featureToday });
});

// ========== 毕业作品订单管理（客服只读） ==========
router.get('/graduation-orders', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = Math.min(100, Math.max(10, parseInt(req.query.size) || 20));
  const status = (req.query.status || '').toString();
  const q = (req.query.q || '').toString().trim();
  const offset = (page - 1) * size;
  let where = 'WHERE 1=1';
  const params = [];
  if (['pending', 'contacted', 'completed'].includes(status)) {
    where += ' AND gpo.contact_status = ?';
    params.push(status);
  }
  if (q) {
    where += ' AND (u.email LIKE ? OR u.name LIKE ? OR gp.title LIKE ? OR o.order_no LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  const total = db.prepare(
    `SELECT COUNT(*) as c FROM graduation_project_orders gpo
     JOIN users u ON u.id = gpo.user_id
     JOIN graduation_projects gp ON gp.id = gpo.project_id ${where}`
  ).get(...params).c;
  const rows = db.prepare(
    `SELECT gpo.id, gpo.status, gpo.contact_status, gpo.quote_status, gpo.quoted_price, gpo.purchased_at, gpo.expires_at, gpo.requirements,
            u.name AS user_name, u.email AS user_email,
            gp.title AS project_title, gp.category,
            o.order_no, o.amount
     FROM graduation_project_orders gpo
     JOIN users u ON u.id = gpo.user_id
     JOIN graduation_projects gp ON gp.id = gpo.project_id
     LEFT JOIN orders o ON o.id = gpo.order_id
     ${where}
     ORDER BY gpo.id DESC LIMIT ? OFFSET ?`
  ).all(...params, size, offset);
  const items = rows.map((r) => {
    let requirements = null;
    try { requirements = r.requirements ? JSON.parse(r.requirements) : null; } catch { requirements = null; }
    return { ...r, requirements };
  });
  res.json({ items, total, page, size, pages: Math.ceil(total / size) });
});

router.put('/graduation-orders/:id/contact-status', (req, res) => {
  const { status } = req.body || {};
  if (!['pending', 'contacted', 'completed'].includes(status)) return res.status(400).json({ error: '无效的对接状态' });
  const row = db.prepare('SELECT id FROM graduation_project_orders WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '订单不存在' });
  db.prepare('UPDATE graduation_project_orders SET contact_status = ? WHERE id = ?').run(status, row.id);
  res.json({ ok: true, id: row.id, contact_status: status });
});

// ========== 跟进备注（沟通时间线）==========
// 获取某订单的备注列表
router.get('/notes', (req, res) => {
  const { order_type, order_ref_id } = req.query;
  if (!['course', 'graduation', 'patent', 'publication'].includes(order_type)) return res.status(400).json({ error: '无效的订单类型' });
  const refId = parseInt(order_ref_id, 10);
  if (!refId) return res.status(400).json({ error: '缺少订单 ID' });
  const notes = db.prepare(
    'SELECT id, author_name, content, created_at FROM order_notes WHERE order_type = ? AND order_ref_id = ? ORDER BY created_at DESC, id DESC'
  ).all(order_type, refId);
  res.json({ notes });
});

// 添加跟进备注
router.post('/notes', (req, res) => {
  const { order_type, order_ref_id, content } = req.body || {};
  if (!['course', 'graduation', 'patent', 'publication'].includes(order_type)) return res.status(400).json({ error: '无效的订单类型' });
  const refId = parseInt(order_ref_id, 10);
  if (!refId) return res.status(400).json({ error: '缺少订单 ID' });
  const text = String(content || '').trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: '请填写备注内容' });
  const info = db.prepare(
    'INSERT INTO order_notes (order_type, order_ref_id, author_id, author_name, content) VALUES (?, ?, ?, ?, ?)'
  ).run(order_type, refId, req.user.id, req.user.name || '', text);
  res.json({ ok: true, id: info.lastInsertRowid, author_name: req.user.name || '', content: text, created_at: Math.floor(Date.now() / 1000) });
});

// ========== 客服报价（提交后待管理员审批，审批通过后才生效）==========
router.post('/graduation-orders/:id/quote', (req, res) => {
  const { quoted_price } = req.body || {};
  const price = Number(quoted_price);
  if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: '报价金额无效' });
  // 金额上限：防止超大数值进入 orders.amount 破坏财务统计与浮点计算
  if (price > 1000000) return res.status(400).json({ error: '报价金额超出上限（100万元）' });
  const row = db.prepare('SELECT id, status FROM graduation_project_orders WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '订单不存在' });
  if (row.status !== 'pending') return res.status(400).json({ error: '订单已支付，不能重新报价' });
  // 客服报价进入待审批状态，需管理员审批后生效
  db.prepare('UPDATE graduation_project_orders SET quoted_price = ?, quote_status = ? WHERE id = ?')
    .run(price, 'pending', row.id);
  // 报价变更：作废用户已创建的待支付订单，防止按旧价成交
  closePendingGraduationOrders(row.id);
  res.json({ ok: true, id: row.id, quoted_price: price, quote_status: 'pending' });
});

// ========== 专利申请 / 期刊发表：客服对接与报价 ==========

// 通用：客服服务订单列表（patent / publication；titleCol 为标题列名，两表列名不同）
function listServiceOrders(req, res, table, titleCol) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = Math.min(100, Math.max(10, parseInt(req.query.size) || 20));
  const status = (req.query.status || '').toString();
  const q = (req.query.q || '').toString().trim();
  const offset = (page - 1) * size;
  let where = 'WHERE 1=1';
  const params = [];
  if (['pending', 'contacted', 'completed'].includes(status)) {
    where += ' AND t.contact_status = ?';
    params.push(status);
  }
  if (q) {
    where += ` AND (u.email LIKE ? OR u.name LIKE ? OR t.${titleCol} LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const total = db.prepare(
    `SELECT COUNT(*) as c FROM ${table} t JOIN users u ON u.id = t.user_id ${where}`
  ).get(...params).c;
  // 两表列结构不同：按表拼接特有列（占位列统一输出结构）
  const extraCols = table === 'patent_orders'
    ? `t.patent_type, t.tech_description, NULL AS paper_title, NULL AS field, NULL AS journal_level, NULL AS requirements`
    : `NULL AS patent_type, NULL AS tech_description, t.paper_title, t.field, t.journal_level, t.requirements`;
  const rows = db.prepare(
    `SELECT t.id, t.${titleCol} AS title, t.status, t.contact_status, t.quote_status, t.quoted_price,
            ${extraCols}, t.created_at,
            u.name AS user_name, u.email AS user_email,
            o.order_no, o.amount
     FROM ${table} t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN orders o ON o.id = t.order_id
     ${where}
     ORDER BY t.id DESC LIMIT ? OFFSET ?`
  ).all(...params, size, offset);
  res.json({ items: rows, total, page, size, pages: Math.ceil(total / size) });
}

// 通用：客服标记对接状态
function updateContactStatus(req, res, table) {
  const { status } = req.body || {};
  if (!['pending', 'contacted', 'completed'].includes(status)) return res.status(400).json({ error: '无效的对接状态' });
  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: '订单不存在' });
  db.prepare(`UPDATE ${table} SET contact_status = ? WHERE id = ?`).run(status, row.id);
  res.json({ ok: true, id: row.id, contact_status: status });
}

// 通用：客服报价（进入待审批，需管理员审批通过才生效）
function quoteServiceOrder(req, res, table) {
  const { quoted_price } = req.body || {};
  const price = Number(quoted_price);
  if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: '报价金额无效' });
  if (price > 1000000) return res.status(400).json({ error: '报价金额超出上限（100万元）' });
  const row = db.prepare(`SELECT id, status FROM ${table} WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: '订单不存在' });
  if (row.status !== 'pending') return res.status(400).json({ error: '订单已支付，不能重新报价' });
  db.prepare(`UPDATE ${table} SET quoted_price = ?, quote_status = ? WHERE id = ?`).run(price, 'pending', row.id);
  res.json({ ok: true, id: row.id, quoted_price: price, quote_status: 'pending' });
}

// 专利申请：客服侧
router.get('/patent-orders', (req, res) => listServiceOrders(req, res, 'patent_orders', 'title'));
router.put('/patent-orders/:id/contact-status', (req, res) => updateContactStatus(req, res, 'patent_orders'));
router.post('/patent-orders/:id/quote', (req, res) => quoteServiceOrder(req, res, 'patent_orders'));

// 期刊发表：客服侧
router.get('/publication-orders', (req, res) => listServiceOrders(req, res, 'publication_orders', 'paper_title'));
router.put('/publication-orders/:id/contact-status', (req, res) => updateContactStatus(req, res, 'publication_orders'));
router.post('/publication-orders/:id/quote', (req, res) => quoteServiceOrder(req, res, 'publication_orders'));

export default router;
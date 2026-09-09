// 客服路由：课程对接管理（admin 或 support 角色可访问）
import { Router } from 'express';
import { supportRequired } from '../middleware.js';
import db from '../db.js';
import { closePendingGraduationOrders, closePendingServiceOrders } from '../services/payment.js';
import { calculateServiceQuoteFloor } from '../services/service-pricing.js';
import { transitionStatus } from '../services/order-state.js';

const router = Router();

// 所有客服路由需要 support 或 admin 权限
router.use(supportRequired);
// 管理员可以查看客服数据，但不能借管理员身份执行报价或履约动作。
router.use((req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (!req.user?.is_support || req.user?.is_admin)) {
    return res.status(403).json({ error: '该操作必须由客服账号在客服工作台完成' });
  }
  next();
});

function parseFormalQuote(body) {
  const price = Number(body?.quoted_price);
  if (!Number.isFinite(price) || price <= 0 || price > 1000000) {
    const error = new Error('报价金额须为 0 至 100 万元之间的有效数字'); error.status = 400; throw error;
  }
  const floor = calculateServiceQuoteFloor({ disciplineCategory: String(body?.discipline_category || ''), estimatedHours: body?.estimated_hours });
  if (price < floor.minimumPrice) {
    const error = new Error(`报价低于平台保护线：该项目最低报价为 ¥${floor.minimumPrice.toFixed(2)}`); error.status = 409; throw error;
  }
  const scope = String(body?.quote_scope || '').trim();
  if (!scope) { const error = new Error('请填写本次报价包含的服务范围和交付物'); error.status = 400; throw error; }
  const exclusions = String(body?.quote_exclusions || '').trim();
  if (scope.length > 3000 || exclusions.length > 2000) { const error = new Error('报价说明内容过长'); error.status = 400; throw error; }
  return { price, floor, scope, exclusions };
}

// ========== 课程指导正式报价（只能由客服操作） ==========
router.get('/course-quote-orders', (_req, res) => {
  const rows = db.prepare(`SELECT o.id,o.order_no,o.status,o.created_at,o.target_name,o.quoted_price,o.metadata,
      u.name AS user_name,u.email AS user_email,
      sp.id AS service_project_id,sp.discipline_category,sp.estimated_hours,sp.scope_summary AS quote_scope,
      sp.quote_exclusions,sp.quote_sent_at
    FROM orders o
    JOIN users u ON u.id=o.user_id
    LEFT JOIN service_projects sp ON sp.order_id=o.id
    WHERE o.type='course' AND o.status IN ('awaiting_quote','quoted')
    ORDER BY o.id DESC`).all();
  res.json({ items: rows.map((row) => {
    let metadata = {};
    try { metadata = JSON.parse(row.metadata || '{}'); } catch {}
    return { ...row, metadata: undefined, requirements: metadata.requirements || {}, course_title: row.target_name };
  }) });
});

router.post('/course-quote-orders/:id/quote', (req, res) => {
  try {
    const order = db.prepare("SELECT * FROM orders WHERE id=? AND type='course'").get(req.params.id);
    if (!order) return res.status(404).json({ error: '指导服务报价申请不存在' });
    if (!['awaiting_quote', 'quoted'].includes(order.status)) return res.status(409).json({ error: `订单状态 ${order.status} 不能报价` });
    const quote = parseFormalQuote(req.body);
    db.transaction(() => {
      db.prepare('UPDATE orders SET quoted_price=?,amount=?,quote_note=? WHERE id=?')
        .run(quote.price, quote.price, `包含：${quote.scope}${quote.exclusions ? `；不包含：${quote.exclusions}` : ''}`, order.id);
      if (order.status === 'awaiting_quote') {
        transitionStatus({ domain:'order', table:'orders', recordId:order.id, field:'status', toStatus:'quoted', orderId:order.id, orderNo:order.order_no, operatorId:req.user.id, operatorName:req.user.email, reason:`客服发送正式报价 ¥${quote.price}` });
      }
      db.prepare(`UPDATE service_projects SET status='awaiting_payment',stage='待用户确认报价',next_action='请用户确认报价并完成付款',
        discipline_category=?,estimated_hours=?,scope_summary=?,quote_exclusions=?,internal_cost_cents=?,cost_snapshot_json=?,
        quoted_by=?,quote_sent_at=strftime('%s','now'),quote_confirmed_at=NULL,updated_at=strftime('%s','now') WHERE order_id=?`)
        .run(quote.floor.disciplineCategory, quote.floor.hours, quote.scope, quote.exclusions,
          Math.round(quote.floor.laborCost * 100), JSON.stringify(quote.floor), req.user.id, order.id);
    })();
    res.json({ ok:true, order_no:order.order_no, quoted_price:quote.price });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

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
  // 已发送、等待用户确认的正式报价
  const gpQuotePending = db.prepare("SELECT COUNT(*) as c FROM graduation_project_orders WHERE quote_status = 'awaiting_customer'").get().c;
  // 超时未处理（待对接超过 24 小时）
  const courseOverdue = db.prepare("SELECT COUNT(*) as c FROM user_courses WHERE contact_status = 'pending' AND purchased_at < ?").get(overdueTs).c;
  const gpOverdue = db.prepare("SELECT COUNT(*) as c FROM graduation_project_orders WHERE contact_status = 'pending' AND purchased_at < ?").get(overdueTs).c;

  // 功能订单（现金直付）统计：待报价订单数、今日新增订单
  const featureAwaitingQuote = db.prepare("SELECT COUNT(*) as c FROM orders WHERE type = 'feature' AND status = 'awaiting_quote'").get().c;
  const courseAwaitingQuote = db.prepare("SELECT COUNT(*) as c FROM orders WHERE type = 'course' AND status = 'awaiting_quote'").get().c;
  const featureToday = db.prepare("SELECT COUNT(*) as c FROM orders WHERE type = 'feature' AND created_at >= ?").get(todayTs).c;

  res.json({ pending, contacted, completed, total, gpPending, gpContacted, gpCompleted, gpTotal, courseToday, gpToday, gpQuotePending, courseOverdue, gpOverdue, featureAwaitingQuote, courseAwaitingQuote, featureToday });
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
            gpo.discipline_category, gpo.estimated_hours, gpo.quote_scope, gpo.quote_exclusions, gpo.quote_sent_at,
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
  // 长度校验：备注内容 ≤2000 字符，超限 400（此前静默截断会造成内容丢失，改为明确提示）
  const text = String(content || '').trim();
  if (!text) return res.status(400).json({ error: '请填写备注内容' });
  if (text.length > 2000) return res.status(400).json({ error: '备注内容过长（最多 2000 字符）' });
  const info = db.prepare(
    'INSERT INTO order_notes (order_type, order_ref_id, author_id, author_name, content) VALUES (?, ?, ?, ?, ?)'
  ).run(order_type, refId, req.user.id, req.user.name || '', text);
  res.json({ ok: true, id: info.lastInsertRowid, author_name: req.user.name || '', content: text, created_at: Math.floor(Date.now() / 1000) });
});

// ========== 客服正式报价（客服确认后直接发送给用户，不再经过管理员审批）==========
router.post('/graduation-orders/:id/quote', (req, res) => {
  let quote;
  try { quote = parseFormalQuote(req.body); } catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  const row = db.prepare('SELECT id, status FROM graduation_project_orders WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '订单不存在' });
  if (row.status !== 'pending') return res.status(400).json({ error: '订单已支付，不能重新报价' });
  db.prepare(`UPDATE graduation_project_orders SET quoted_price=?, quote_status='awaiting_customer', discipline_category=?, estimated_hours=?, quote_scope=?, quote_exclusions=?, cost_snapshot_json=?, quoted_by=?, quote_sent_at=strftime('%s','now'), quote_confirmed_at=NULL WHERE id=?`)
    .run(quote.price, quote.floor.disciplineCategory, quote.floor.hours, quote.scope, quote.exclusions, JSON.stringify(quote.floor), req.user.id, row.id);
  // 报价变更：作废用户已创建的待支付订单，防止按旧价成交
  closePendingGraduationOrders(row.id);
  res.json({ ok: true, id: row.id, quoted_price: quote.price, quote_status: 'awaiting_customer', minimum_price: quote.floor.minimumPrice });
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
            ${extraCols}, t.created_at, t.discipline_category, t.estimated_hours, t.quote_scope, t.quote_exclusions, t.quote_sent_at,
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

// 通用：客服正式报价（直接发送给用户确认）
function quoteServiceOrder(req, res, table) {
  let quote;
  try { quote = parseFormalQuote(req.body); } catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  const row = db.prepare(`SELECT id, status FROM ${table} WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: '订单不存在' });
  if (row.status !== 'pending') return res.status(400).json({ error: '订单已支付，不能重新报价' });
  db.prepare(`UPDATE ${table} SET quoted_price=?, quote_status='awaiting_customer', discipline_category=?, estimated_hours=?, quote_scope=?, quote_exclusions=?, cost_snapshot_json=?, quoted_by=?, quote_sent_at=strftime('%s','now'), quote_confirmed_at=NULL WHERE id=?`)
    .run(quote.price, quote.floor.disciplineCategory, quote.floor.hours, quote.scope, quote.exclusions, JSON.stringify(quote.floor), req.user.id, row.id);
  // 报价变更：作废用户已创建的待支付订单，防止按旧价成交（对齐 graduation 分支）
  closePendingServiceOrders(table === 'patent_orders' ? 'patent' : 'publication', row.id);
  res.json({ ok: true, id: row.id, quoted_price: quote.price, quote_status: 'awaiting_customer', minimum_price: quote.floor.minimumPrice });
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

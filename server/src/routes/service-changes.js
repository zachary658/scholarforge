import { Router } from 'express';
import db from '../db.js';
import { adminRequired, authRequired, supportRequired } from '../middleware.js';
import { createChangeOrderPayment } from '../services/payment.js';
import { calculateServiceQuoteFloor } from '../services/service-pricing.js';
import { now } from '../utils.js';

const userRouter = Router();
userRouter.use(authRequired);

function publicChange(row) {
  if (!row) return row;
  const { cost_snapshot_json: _cost, quoted_by: _by, ...safe } = row;
  return safe;
}

userRouter.get('/', (req, res) => {
  const orders = db.prepare("SELECT id,order_no,type,target_name,amount,status,created_at FROM orders WHERE user_id=? AND type IN ('course','graduation','patent','publication') AND status IN ('paid','processing','completed') ORDER BY id DESC").all(req.user.id);
  const changes = db.prepare(`SELECT c.*,o.order_no AS source_order_no,o.target_name AS source_name,p.order_no AS payment_order_no
    FROM service_change_orders c JOIN orders o ON o.id=c.source_order_id LEFT JOIN orders p ON p.id=c.payment_order_id
    WHERE c.user_id=? ORDER BY c.id DESC`).all(req.user.id).map(publicChange);
  res.json({ orders, changes });
});

userRouter.post('/', (req, res) => {
  const orderId = Number(req.body?.source_order_id);
  const summary = String(req.body?.request_summary || '').trim();
  const deadline = String(req.body?.requested_deadline || '').trim().slice(0, 200);
  if (!summary || summary.length > 3000) return res.status(400).json({ error: '请填写 1-3000 字的变更需求' });
  const order = db.prepare("SELECT id FROM orders WHERE id=? AND user_id=? AND type IN ('course','graduation','patent','publication') AND status IN ('paid','processing','completed')").get(orderId, req.user.id);
  if (!order) return res.status(404).json({ error: '请选择您已付款的人工服务订单' });
  const open = db.prepare("SELECT id FROM service_change_orders WHERE source_order_id=? AND user_id=? AND status IN ('pending','needs_info','awaiting_customer','payment_pending','in_progress')").get(orderId, req.user.id);
  if (open) return res.status(409).json({ error: '该项目已有处理中变更单，请先完成或联系客服' });
  const info = db.prepare('INSERT INTO service_change_orders (user_id,source_order_id,request_summary,requested_deadline) VALUES (?,?,?,?)').run(req.user.id, orderId, summary, deadline);
  const id = Number(info.lastInsertRowid); const changeNo = `BG${String(id).padStart(8, '0')}`;
  db.prepare('UPDATE service_change_orders SET change_no=? WHERE id=?').run(changeNo, id);
  res.json({ ok: true, change: publicChange(db.prepare('SELECT * FROM service_change_orders WHERE id=?').get(id)) });
});

userRouter.post('/:id/confirm', (req, res) => {
  const change = db.prepare('SELECT * FROM service_change_orders WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!change) return res.status(404).json({ error: '变更单不存在' });
  if (!['awaiting_customer', 'payment_pending'].includes(change.status)) return res.status(409).json({ error: '该变更单不在待确认状态' });
  if (change.assessment_type === 'included') {
    db.prepare("UPDATE service_change_orders SET status='in_progress',customer_confirmed_at=?,updated_at=? WHERE id=?").run(now(), now(), change.id);
    return res.json({ ok: true, free: true });
  }
  try { res.json(createChangeOrderPayment({ userId: req.user.id, changeOrderId: change.id, paymentMethod: req.body?.payment_method || null })); }
  catch (error) { res.status(400).json({ error: error.message }); }
});

userRouter.post('/:id/withdraw', (req, res) => {
  const result = db.prepare("UPDATE service_change_orders SET status='withdrawn',updated_at=? WHERE id=? AND user_id=? AND status IN ('pending','needs_info','awaiting_customer')").run(now(), req.params.id, req.user.id);
  if (!result.changes) return res.status(409).json({ error: '该变更单当前不能撤回' });
  res.json({ ok: true });
});

export function createServiceChangeStaffRouter({ readOnly = false } = {}) {
  const staff = Router();
  staff.use(readOnly ? adminRequired : supportRequired);
  staff.get('/', (req, res) => {
    const where = req.query.status ? 'WHERE c.status=?' : '';
    const params = req.query.status ? [String(req.query.status)] : [];
    const items = db.prepare(`SELECT c.*,u.name AS user_name,u.email AS user_email,o.order_no AS source_order_no,o.type AS source_type,o.target_name AS source_name,p.order_no AS payment_order_no,p.status AS payment_status
      FROM service_change_orders c JOIN users u ON u.id=c.user_id JOIN orders o ON o.id=c.source_order_id LEFT JOIN orders p ON p.id=c.payment_order_id ${where} ORDER BY c.id DESC LIMIT 200`).all(...params);
    res.json({ items });
  });
  staff.put('/:id/assess', (req, res) => {
    if (readOnly || !req.user?.is_support) return res.status(403).json({ error: '变更单只能由客服评估处理' });
    const change = db.prepare('SELECT * FROM service_change_orders WHERE id=?').get(req.params.id);
    if (!change) return res.status(404).json({ error: '变更单不存在' });
    if (!['pending', 'needs_info', 'awaiting_customer'].includes(change.status)) return res.status(409).json({ error: '当前状态不能重新评估' });
    const action = String(req.body?.action || 'quote');
    if (action === 'needs_info') {
      db.prepare("UPDATE service_change_orders SET status='needs_info',support_note=?,updated_at=? WHERE id=?").run(String(req.body?.support_note || '').trim().slice(0, 2000), now(), change.id);
      return res.json({ ok: true });
    }
    if (action === 'reject') {
      db.prepare("UPDATE service_change_orders SET status='rejected',assessment_type='rejected',support_note=?,quoted_by=?,quoted_at=?,updated_at=? WHERE id=?").run(String(req.body?.support_note || '').trim().slice(0, 2000), req.user.id, now(), now(), change.id);
      return res.json({ ok: true });
    }
    const assessmentType = String(req.body?.assessment_type || 'chargeable');
    if (!['included', 'chargeable'].includes(assessmentType)) return res.status(400).json({ error: '请选择套餐内处理或收费变更' });
    const scope = String(req.body?.change_scope || '').trim();
    if (!scope || scope.length > 3000) return res.status(400).json({ error: '请填写本次变更的明确交付范围' });
    let floor = null; let amountCents = 0;
    if (assessmentType === 'chargeable') {
      try { floor = calculateServiceQuoteFloor({ disciplineCategory: String(req.body?.discipline_category || ''), estimatedHours: req.body?.estimated_hours }); }
      catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
      const price = Number(req.body?.quoted_price);
      if (!Number.isFinite(price) || price < floor.minimumPrice || price > 1000000) return res.status(409).json({ error: `收费变更最低报价为 ¥${floor.minimumPrice.toFixed(2)}` });
      amountCents = Math.round(price * 100);
    }
    db.prepare(`UPDATE service_change_orders SET status='awaiting_customer',assessment_type=?,discipline_category=?,estimated_hours=?,change_scope=?,quote_exclusions=?,amount_cents=?,cost_snapshot_json=?,support_note=?,quoted_by=?,quoted_at=?,customer_confirmed_at=NULL,updated_at=? WHERE id=?`)
      .run(assessmentType, floor?.disciplineCategory || String(req.body?.discipline_category || 'humanities'), floor?.hours || 0, scope, String(req.body?.quote_exclusions || '').trim().slice(0, 2000), amountCents, JSON.stringify(floor || {}), String(req.body?.support_note || '').trim().slice(0, 2000), req.user.id, now(), now(), change.id);
    res.json({ ok: true, minimum_price: floor?.minimumPrice || 0 });
  });
  staff.put('/:id/complete', (req, res) => {
    if (readOnly || !req.user?.is_support) return res.status(403).json({ error: '变更单只能由客服完成' });
    const result = db.prepare("UPDATE service_change_orders SET status='completed',completed_at=?,updated_at=? WHERE id=? AND status='in_progress'").run(now(), now(), req.params.id);
    if (!result.changes) return res.status(409).json({ error: '只有进行中的变更单可以完成' });
    res.json({ ok: true });
  });
  return staff;
}

export default userRouter;

import crypto from 'crypto';
import db from '../db.js';
import { datePrefix, now } from '../utils.js';

export const SERVICE_STATUSES = [
  'submitted', 'evaluating', 'awaiting_quote', 'awaiting_payment', 'paid',
  'in_progress', 'waiting_customer', 'pending_acceptance', 'revision',
  'completed', 'cancelled', 'refunded',
];

const TRANSITIONS = {
  submitted: ['evaluating', 'awaiting_quote', 'cancelled'],
  evaluating: ['awaiting_quote', 'awaiting_payment', 'cancelled'],
  awaiting_quote: ['awaiting_payment', 'evaluating', 'cancelled'],
  awaiting_payment: ['paid', 'evaluating', 'cancelled'],
  paid: ['in_progress', 'refunded'],
  in_progress: ['waiting_customer', 'pending_acceptance', 'refunded'],
  waiting_customer: ['in_progress', 'pending_acceptance', 'refunded'],
  pending_acceptance: ['completed', 'revision', 'refunded'],
  revision: ['in_progress', 'waiting_customer', 'pending_acceptance', 'refunded'],
  completed: ['refunded'],
  cancelled: [],
  refunded: [],
};

const DEFAULTS = {
  submitted: [5, '需求已提交', '等待平台评估需求'],
  evaluating: [10, '需求评估中', '等待平台给出方案或报价'],
  awaiting_quote: [15, '等待报价', '等待平台完成报价'],
  awaiting_payment: [20, '等待付款', '确认报价并完成付款'],
  paid: [25, '已付款', '等待服务正式开始'],
  in_progress: [55, '服务进行中', '查看最新进度并等待阶段成果'],
  waiting_customer: [60, '等待补充信息', '请按进度说明补充所需信息'],
  pending_acceptance: [95, '等待验收', '请下载成果并确认或提交修改意见'],
  revision: [80, '修改处理中', '等待修改完成后重新验收'],
  completed: [100, '已完成', '服务已完成，可随时下载成果'],
  cancelled: [0, '已取消', '无需操作'],
  refunded: [0, '已退款', '无需操作'],
};

export function normalizePromotionCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

export function resolvePromotion(codeValue) {
  const code = normalizePromotionCode(codeValue);
  if (!code) return null;
  const row = db.prepare(
    `SELECT pc.id, pc.code, pc.is_active, pc.valid_from, pc.valid_until,
            pp.id AS partner_id, pp.name AS partner_name, pp.is_active AS partner_active
     FROM promotion_codes pc JOIN promotion_partners pp ON pp.id = pc.partner_id
     WHERE pc.code = ? COLLATE NOCASE`
  ).get(code);
  const ts = now();
  if (!row || !row.is_active || !row.partner_active || (row.valid_from && row.valid_from > ts) || (row.valid_until && row.valid_until < ts)) {
    const err = new Error('推广码不存在、已停用或不在有效期内');
    err.status = 400;
    throw err;
  }
  return row;
}

function projectNo(type, id) {
  const prefix = type === 'thesis_coaching' ? 'TG' : 'GP';
  return `${prefix}${datePrefix()}${String(id).padStart(6, '0')}${crypto.randomBytes(1).toString('hex').toUpperCase()}`;
}

function createNotification(userId, title, content, projectId, eventKey) {
  db.prepare(
    `INSERT OR IGNORE INTO notifications (user_id, title, content, link, event_key)
     VALUES (?, ?, ?, ?, ?)`
  ).run(userId, title, content || '', `/app/service-projects/${projectId}`, eventKey);
}

export function ensureServiceProject({ userId, serviceType, sourceType, sourceId, orderId = null, requestSnapshot = {}, promotionCode = '', status = 'submitted' }) {
  const existing = db.prepare('SELECT * FROM service_projects WHERE source_type = ? AND source_id = ?').get(sourceType, sourceId);
  if (existing) return existing;
  const promotion = resolvePromotion(promotionCode);
  const defaults = DEFAULTS[status] || DEFAULTS.submitted;
  const insert = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO service_projects
       (user_id, service_type, source_type, source_id, order_id, status, progress, stage, next_action,
        request_snapshot_json, promotion_code_id, promotion_code_snapshot, promotion_partner_snapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId, serviceType, sourceType, sourceId, orderId, status, defaults[0], defaults[1], defaults[2],
      JSON.stringify(requestSnapshot || {}), promotion?.id || null, promotion?.code || null, promotion?.partner_name || null,
    );
    const id = Number(info.lastInsertRowid);
    db.prepare('UPDATE service_projects SET project_no = ? WHERE id = ?').run(projectNo(serviceType, id), id);
    db.prepare(
      `INSERT INTO service_project_updates
       (service_project_id, from_status, to_status, progress, stage, user_visible_note, operator_role, idempotency_key)
       VALUES (?, NULL, ?, ?, ?, ?, 'system', 'created')`
    ).run(id, status, defaults[0], defaults[1], '服务项目已创建');
    createNotification(userId, '服务项目已创建', '可在服务进度中查看后续状态与交付成果。', id, `service:${id}:created`);
    return db.prepare('SELECT * FROM service_projects WHERE id = ?').get(id);
  });
  return insert();
}

export function activatePaidServiceProject({ sourceType, sourceId, orderId }) {
  const project = db.prepare('SELECT * FROM service_projects WHERE source_type = ? AND source_id = ?').get(sourceType, sourceId);
  if (!project) return null;
  if (['paid', 'in_progress', 'waiting_customer', 'pending_acceptance', 'revision', 'completed'].includes(project.status)) {
    if (!project.order_id && orderId) db.prepare('UPDATE service_projects SET order_id = ? WHERE id = ?').run(orderId, project.id);
    return project;
  }
  return updateServiceProject(project.id, {
    expectedVersion: project.version,
    status: 'paid',
    orderId,
    note: '付款已确认，服务项目进入待启动阶段。',
    operatorRole: 'system',
    idempotencyKey: `paid:${orderId}`,
    lockPromotion: true,
  });
}

export function linkServiceOrder({ sourceType, sourceId, orderId }) {
  const project = db.prepare('SELECT * FROM service_projects WHERE source_type=? AND source_id=?').get(sourceType, sourceId);
  if (!project) return null;
  if (project.order_id === orderId && project.status === 'awaiting_payment') return project;
  if (!TRANSITIONS[project.status]?.includes('awaiting_payment')) {
    db.prepare('UPDATE service_projects SET order_id=COALESCE(order_id, ?), updated_at=? WHERE id=?').run(orderId, now(), project.id);
    return project;
  }
  return updateServiceProject(project.id, {
    expectedVersion: project.version,
    status: 'awaiting_payment',
    orderId,
    note: '报价已确认，请完成付款以启动服务。',
    operatorRole: 'system',
    idempotencyKey: `order:${orderId}`,
  });
}

export function getServiceProject(id, userId = null) {
  const where = userId == null ? 'sp.id = ?' : 'sp.id = ? AND sp.user_id = ?';
  const args = userId == null ? [id] : [id, userId];
  const project = db.prepare(
    `SELECT sp.*, u.name AS user_name, u.email AS user_email, o.order_no, o.amount, o.status AS order_status
     FROM service_projects sp JOIN users u ON u.id = sp.user_id
     LEFT JOIN orders o ON o.id = sp.order_id WHERE ${where}`
  ).get(...args);
  if (!project) return null;
  try { project.request_snapshot = JSON.parse(project.request_snapshot_json || '{}'); } catch { project.request_snapshot = {}; }
  delete project.request_snapshot_json;
  const updates = db.prepare(
    `SELECT id, from_status, to_status, progress, stage, user_visible_note, operator_role, created_at
     FROM service_project_updates WHERE service_project_id = ? ORDER BY id`
  ).all(project.id);
  const submissions = db.prepare(
    `SELECT id, kind, content, created_at FROM service_project_submissions
     WHERE service_project_id = ? ORDER BY id DESC`
  ).all(project.id);
  const attachments = db.prepare(
    `SELECT id, role, original_name, mime_type, size, created_at FROM service_project_attachments
     WHERE service_project_id = ? AND deleted_at IS NULL ORDER BY id DESC`
  ).all(project.id);
  return { ...project, internal_note: undefined, updates, submissions, attachments };
}

export function listServiceProjects({ userId = null, status = '', serviceType = '', q = '' } = {}) {
  const where = ['1=1'];
  const params = [];
  if (userId != null) { where.push('sp.user_id = ?'); params.push(userId); }
  if (SERVICE_STATUSES.includes(status)) { where.push('sp.status = ?'); params.push(status); }
  if (['thesis_coaching', 'graduation_project'].includes(serviceType)) { where.push('sp.service_type = ?'); params.push(serviceType); }
  if (q) {
    where.push('(sp.project_no LIKE ? OR u.name LIKE ? OR u.email LIKE ? OR sp.promotion_code_snapshot LIKE ?)');
    const like = `%${String(q).trim()}%`; params.push(like, like, like, like);
  }
  return db.prepare(
    `SELECT sp.id, sp.project_no, sp.user_id, sp.service_type, sp.status, sp.progress, sp.stage, sp.next_action,
            sp.eta_at, sp.promotion_code_snapshot, sp.promotion_partner_snapshot, sp.version, sp.updated_at,
            u.name AS user_name, u.email AS user_email, o.order_no, o.amount, o.status AS order_status
     FROM service_projects sp JOIN users u ON u.id = sp.user_id LEFT JOIN orders o ON o.id = sp.order_id
     WHERE ${where.join(' AND ')} ORDER BY sp.updated_at DESC, sp.id DESC`
  ).all(...params);
}

export function updateServiceProject(id, options) {
  const current = db.prepare('SELECT * FROM service_projects WHERE id = ?').get(id);
  if (!current) { const err = new Error('服务项目不存在'); err.status = 404; throw err; }
  if (options.idempotencyKey) {
    const prior = db.prepare('SELECT id FROM service_project_updates WHERE service_project_id=? AND idempotency_key=?').get(id, options.idempotencyKey);
    if (prior) return current;
  }
  const expected = Number(options.expectedVersion);
  if (!Number.isInteger(expected) || expected !== current.version) {
    const err = new Error('项目已被其他操作更新，请刷新后重试'); err.status = 409; err.code = 'VERSION_CONFLICT'; throw err;
  }
  const target = options.status || current.status;
  if (!SERVICE_STATUSES.includes(target)) { const err = new Error('无效的项目状态'); err.status = 400; throw err; }
  if (target !== current.status && !TRANSITIONS[current.status]?.includes(target)) {
    const err = new Error(`不能从 ${current.status} 变更为 ${target}`); err.status = 409; throw err;
  }
  const defaults = DEFAULTS[target];
  const requestedProgress = options.progress == null ? null : Number(options.progress);
  if (requestedProgress != null && !Number.isFinite(requestedProgress)) {
    const err = new Error('进度必须是 0-100 之间的数字'); err.status = 400; throw err;
  }
  const progress = requestedProgress == null ? Math.max(current.progress, defaults[0]) : Math.max(0, Math.min(100, requestedProgress));
  const etaAt = options.etaAt == null || options.etaAt === '' ? null : Number(options.etaAt);
  if (etaAt != null && (!Number.isInteger(etaAt) || etaAt <= 0)) {
    const err = new Error('预计完成时间格式无效'); err.status = 400; throw err;
  }
  const stage = String(options.stage || defaults[1]).trim().slice(0, 100);
  const nextAction = String(options.nextAction || defaults[2]).trim().slice(0, 300);
  const note = String(options.note || '').trim().slice(0, 2000);
  const internalNote = String(options.internalNote || '').trim().slice(0, 2000);
  const transaction = db.transaction(() => {
    const result = db.prepare(
      `UPDATE service_projects SET status=?, progress=?, stage=?, next_action=?, eta_at=?,
       user_visible_note=?, internal_note=?, order_id=COALESCE(?, order_id),
       promotion_locked_at=CASE WHEN ? THEN COALESCE(promotion_locked_at, ?) ELSE promotion_locked_at END,
       version=version+1, updated_at=? WHERE id=? AND version=?`
    ).run(target, progress, stage, nextAction, etaAt, note || current.user_visible_note,
      internalNote || current.internal_note, options.orderId || null, options.lockPromotion ? 1 : 0, now(), now(), id, expected);
    if (!result.changes) { const err = new Error('项目已被其他操作更新，请刷新后重试'); err.status = 409; throw err; }
    db.prepare(
      `INSERT OR IGNORE INTO service_project_updates
       (service_project_id, from_status, to_status, progress, stage, user_visible_note, internal_note, operator_id, operator_role, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, current.status, target, progress, stage, note, internalNote, options.operatorId || null,
      options.operatorRole || 'staff', options.idempotencyKey || null);
    if (target !== current.status || note) {
      createNotification(current.user_id, `服务进度更新：${stage}`, note || nextAction, id,
        `service:${id}:v${expected + 1}`);
    }
    return db.prepare('SELECT * FROM service_projects WHERE id = ?').get(id);
  });
  return transaction();
}

export function addSubmission(project, userId, kind, content, idempotencyKey = null) {
  if (!['supplement', 'revision_request', 'acceptance'].includes(kind)) throw new Error('无效的提交类型');
  const text = String(content || '').trim().slice(0, 5000);
  if (kind !== 'acceptance' && !text) { const err = new Error('请填写内容'); err.status = 400; throw err; }
  const transaction = db.transaction(() => {
    const info = db.prepare(
      `INSERT OR IGNORE INTO service_project_submissions
       (service_project_id, user_id, kind, content, idempotency_key) VALUES (?, ?, ?, ?, ?)`
    ).run(project.id, userId, kind, text, idempotencyKey || null);
    if (kind === 'acceptance' && project.status === 'pending_acceptance') {
      updateServiceProject(project.id, { expectedVersion: project.version, status: 'completed', note: '用户已确认验收。', operatorId: userId, operatorRole: 'user' });
    } else if (kind === 'revision_request' && project.status === 'pending_acceptance') {
      updateServiceProject(project.id, { expectedVersion: project.version, status: 'revision', note: '用户已提交修改意见。', operatorId: userId, operatorRole: 'user' });
    }
    return info;
  });
  return transaction();
}

export function promotionStats() {
  return db.prepare(
    `SELECT pc.id, pc.code, pc.is_active, pp.name AS partner_name,
            COUNT(sp.id) AS project_count,
            SUM(CASE WHEN sp.status IN ('paid','in_progress','waiting_customer','pending_acceptance','revision','completed') THEN 1 ELSE 0 END) AS paid_count,
            COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.amount ELSE 0 END), 0) AS paid_amount
     FROM promotion_codes pc JOIN promotion_partners pp ON pp.id = pc.partner_id
     LEFT JOIN service_projects sp ON sp.promotion_code_id = pc.id LEFT JOIN orders o ON o.id = sp.order_id
     GROUP BY pc.id ORDER BY pc.id DESC`
  ).all();
}

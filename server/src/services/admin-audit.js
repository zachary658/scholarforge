import crypto from 'crypto';
import db from '../db.js';
import logger, { redact } from '../logger.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const HMAC_VERSION = 2;
const HMAC_KEY_VERSION = 1;
const TABLES = new Set([
  'feature_prices', 'courses', 'user_courses', 'orders', 'templates', 'users',
  'graduation_projects', 'graduation_project_orders', 'patent_orders',
  'publication_orders', 'service_projects', 'promotion_partners', 'promotion_codes',
]);

function safeJson(value) {
  if (value === undefined) return null;
  try { return JSON.stringify(redact(value)); } catch { return JSON.stringify('[unserializable]'); }
}

function auditRequestBody(req) {
  const body = req.body && typeof req.body === 'object' ? { ...req.body } : req.body;
  if (body && /(^|\/)secure-config\//.test(req.path)) body.value = '***redacted***';
  return body;
}

function snapshotTable(table, id, idColumn = 'id') {
  if (!TABLES.has(table) || id === undefined || id === null || id === '') return null;
  const column = idColumn === 'key' ? 'key' : 'id';
  try { return db.prepare(`SELECT * FROM ${table} WHERE ${column} = ?`).get(id) || null; } catch { return null; }
}

function snapshotSettings(body) {
  const keys = Object.keys(body || {}).filter((key) => /^[a-z0-9_.-]{1,80}$/i.test(key));
  if (keys.length === 0) return null;
  const placeholders = keys.map(() => '?').join(',');
  try { return db.prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders}) ORDER BY key`).all(...keys); } catch { return null; }
}

function resolveTarget(req) {
  const path = req.path.replace(/^\//, '');
  const parts = path.split('/').filter(Boolean);
  const id = parts[1] || '';
  if (parts[0] === 'features') return { type: 'feature_price', table: 'feature_prices', id: req.params?.key || id || req.body?.key, idColumn: 'key' };
  if (parts[0] === 'courses') return { type: 'course', table: 'courses', id: req.params?.id || id || req.body?.id };
  if (parts[0] === 'course-orders') return { type: 'course_order', table: 'user_courses', id: req.params?.id || id };
  if (parts[0] === 'orders') return { type: 'order', table: 'orders', id: req.params?.id || id };
  if (parts[0] === 'templates') return { type: 'template', table: 'templates', id: req.params?.id || id || req.body?.id };
  if (parts[0] === 'users') return { type: 'user', table: 'users', id: req.params?.id || id || req.body?.id };
  if (parts[0] === 'graduation-orders') return { type: 'graduation_order', table: 'graduation_project_orders', id: req.params?.id || id };
  if (parts[0] === 'graduation') return { type: 'graduation_project', table: 'graduation_projects', id: req.params?.id || id || req.body?.id };
  if (parts[0] === 'patent-orders') return { type: 'patent_order', table: 'patent_orders', id: req.params?.id || id };
  if (parts[0] === 'publication-orders') return { type: 'publication_order', table: 'publication_orders', id: req.params?.id || id };
  if (parts[0] === 'service-projects') return { type: 'service_project', table: 'service_projects', id: req.params?.id || id };
  if (parts[0] === 'promotion') {
    const subtype = parts[1] || '';
    const targetId = parts[2] || req.body?.id;
    if (subtype.includes('partner')) return { type: 'promotion_partner', table: 'promotion_partners', id: targetId };
    if (subtype.includes('code')) return { type: 'promotion_code', table: 'promotion_codes', id: targetId };
  }
  if (parts[0] === 'settings' || parts[0] === 'models') return { type: 'settings', settings: true, id: parts.slice(1).join('/') || 'bulk' };
  return { type: parts[0] || 'admin', id: id || '' };
}

function takeSnapshot(target, body) {
  return target.settings ? snapshotSettings(body) : snapshotTable(target.table, target.id, target.idColumn);
}

function auditMaterial(entry, prevHash) {
  return JSON.stringify({
    actor_id: entry.actor_id,
    actor_email: entry.actor_email,
    actor_role: entry.actor_role,
    action: entry.action,
    target_type: entry.target_type,
    target_id: entry.target_id,
    request_id: entry.request_id,
    ip_address: entry.ip_address,
    user_agent: entry.user_agent,
    success: entry.success,
    status_code: entry.status_code,
    before_json: entry.before_json,
    after_json: entry.after_json,
    request_json: entry.request_json,
    error_message: entry.error_message,
    created_at: entry.created_at,
    prev_hash: prevHash,
  });
}

function auditHmacKey() {
  let source = process.env.AUDIT_HMAC_KEY || process.env.CONFIG_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if ((!source || source.length < 32) && process.env.NODE_ENV !== 'production') {
    source = 'scholarforge-development-audit-key-not-for-production';
  }
  if (!source || source.length < 32) {
    throw Object.assign(new Error('审计 HMAC 不可用：请配置至少 32 字符的 AUDIT_HMAC_KEY、CONFIG_ENCRYPTION_KEY 或 JWT_SECRET'), { statusCode: 503 });
  }
  return crypto.hkdfSync('sha256', Buffer.from(source), Buffer.from('scholarforge-admin-audit'), Buffer.from('hmac-sha256-v1'), 32);
}

function hashEntry(entry, prevHash, version = HMAC_VERSION) {
  const material = auditMaterial(entry, prevHash);
  return Number(version) === 1
    ? crypto.createHash('sha256').update(material).digest('hex')
    : crypto.createHmac('sha256', auditHmacKey()).update(material).digest('hex');
}

function hashesEqual(actual, expected) {
  if (!/^[a-f0-9]{64}$/i.test(String(actual || '')) || !/^[a-f0-9]{64}$/i.test(String(expected || ''))) return false;
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

export function appendAdminAudit(entry) {
  const insert = db.transaction(() => {
    const previous = db.prepare('SELECT entry_hash FROM admin_operation_logs ORDER BY id DESC LIMIT 1').get();
    const prevHash = previous?.entry_hash || '';
    const entryHash = hashEntry(entry, prevHash, HMAC_VERSION);
    db.prepare(`INSERT INTO admin_operation_logs (
      actor_id, actor_email, actor_role, action, target_type, target_id, request_id,
      ip_address, user_agent, success, status_code, before_json, after_json,
      request_json, error_message, prev_hash, entry_hash, created_at, hash_version, key_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      entry.actor_id, entry.actor_email, entry.actor_role, entry.action, entry.target_type,
      entry.target_id, entry.request_id, entry.ip_address, entry.user_agent, entry.success,
      entry.status_code, entry.before_json, entry.after_json, entry.request_json,
      entry.error_message, prevHash, entryHash, entry.created_at, HMAC_VERSION, HMAC_KEY_VERSION,
    );
  });
  insert();
}

export function verifyAdminAuditChain() {
  const rows = db.prepare('SELECT * FROM admin_operation_logs ORDER BY id').all();
  let previousHash = '';
  let legacyEntries = 0;
  let checked = 0;
  for (const row of rows) {
    const version = Number(row.hash_version || 1);
    if (row.prev_hash !== previousHash) {
      return { ok: false, total: rows.length, checked, broken_id: row.id, reason: 'PREVIOUS_HASH_MISMATCH', legacy_entries: legacyEntries, head_hash: previousHash };
    }
    if (version !== 1 && version !== HMAC_VERSION) {
      return { ok: false, total: rows.length, checked, broken_id: row.id, reason: 'UNSUPPORTED_HASH_VERSION', legacy_entries: legacyEntries, head_hash: previousHash };
    }
    if (version === 1) legacyEntries += 1;
    const expected = hashEntry(row, row.prev_hash, version);
    if (!hashesEqual(row.entry_hash, expected)) {
      return { ok: false, total: rows.length, checked, broken_id: row.id, reason: 'ENTRY_HASH_MISMATCH', legacy_entries: legacyEntries, head_hash: previousHash };
    }
    previousHash = row.entry_hash;
    checked += 1;
  }
  return { ok: true, total: rows.length, checked: rows.length, broken_id: null, reason: null, legacy_entries: legacyEntries, head_hash: previousHash, hash_version: HMAC_VERSION, key_version: HMAC_KEY_VERSION };
}

export function adminAuditMiddleware(req, res, next) {
  if (!MUTATING_METHODS.has(req.method)) return next();
  const target = resolveTarget(req);
  const before = takeSnapshot(target, req.body);
  let responseBody;
  const originalJson = res.json.bind(res);
  res.json = (body) => { responseBody = body; return originalJson(body); };
  res.once('finish', () => {
    try {
      const responseId = responseBody?.id || responseBody?.item?.id || responseBody?.data?.id;
      if (!target.id && responseId) target.id = responseId;
      const after = takeSnapshot(target, req.body);
      appendAdminAudit({
        actor_id: req.user?.id || null,
        actor_email: req.user?.email || '',
        actor_role: req.user?.is_admin ? 'admin' : 'support',
        action: `${req.method} ${req.baseUrl}${req.path}`,
        target_type: target.type,
        target_id: String(target.id || ''),
        request_id: String(req.headers['x-request-id'] || ''),
        ip_address: String(req.ip || ''),
        user_agent: String(req.headers['user-agent'] || '').slice(0, 500),
        success: res.statusCode < 400 ? 1 : 0,
        status_code: res.statusCode,
        before_json: safeJson(before),
        after_json: safeJson(after || responseBody),
        request_json: safeJson(auditRequestBody(req)),
        error_message: res.statusCode >= 400 ? String(responseBody?.error || '').slice(0, 1000) : '',
        created_at: Math.floor(Date.now() / 1000),
      });
    } catch (err) {
      // 审计记录失败不得把已完成的业务响应变成失败；数据库异常由运行日志告警发现。
      logger.error('admin-audit', 'failed to append operation log', { error: err.message });
    }
  });
  next();
}

export function listAdminAuditLogs({ page = 1, size = 20, actor = '', action = '', target = '', success = '' } = {}) {
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safeSize = Math.min(100, Math.max(10, Number.parseInt(size, 10) || 20));
  const clauses = [];
  const params = [];
  if (actor) { clauses.push('(actor_email LIKE ? OR CAST(actor_id AS TEXT) = ?)'); params.push(`%${actor}%`, actor); }
  if (action) { clauses.push('action LIKE ?'); params.push(`%${action}%`); }
  if (target) { clauses.push('(target_type LIKE ? OR target_id LIKE ?)'); params.push(`%${target}%`, `%${target}%`); }
  if (success === 'true' || success === 'false') { clauses.push('success = ?'); params.push(success === 'true' ? 1 : 0); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS count FROM admin_operation_logs ${where}`).get(...params).count;
  const items = db.prepare(`SELECT * FROM admin_operation_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, safeSize, (safePage - 1) * safeSize)
    .map((row) => ({ ...row, success: Boolean(row.success) }));
  return { items, total, page: safePage, size: safeSize, pages: Math.ceil(total / safeSize) };
}

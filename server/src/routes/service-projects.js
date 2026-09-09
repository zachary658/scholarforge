import crypto from 'crypto';
import fs from 'fs';
import { dirname, extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { Router } from 'express';
import db from '../db.js';
import { verifyPassword } from '../auth.js';
import { adminRequired, authRequired, supportRequired } from '../middleware.js';
import { checkFileSignature, FILE_SIGNATURES } from '../utils.js';
import {
  addSubmission, getServiceProject, listServiceProjects, normalizePromotionCode,
  deletePromotionCode, deletePromotionPartner, promotionPartnerStats, promotionStats,
  resolvePromotion, setPromotionPartnerActive, updateServiceProject,
} from '../services/service-project-service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const attachmentDir = join(__dirname, '..', '..', 'uploads', 'service-projects');
const attachmentRoot = resolve(attachmentDir);
fs.mkdirSync(attachmentDir, { recursive: true });

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx', '.xlsx', '.csv', '.txt', '.zip', '.png', '.jpg', '.jpeg']);
const ALLOWED_MIME = {
  '.pdf': ['application/pdf'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/octet-stream'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'application/octet-stream'],
  '.csv': ['text/csv', 'text/plain', 'application/vnd.ms-excel'],
  '.txt': ['text/plain'],
  '.zip': ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
};
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, attachmentDir),
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    const allowed = ALLOWED_EXTENSIONS.has(ext) && ALLOWED_MIME[ext]?.includes(file.mimetype);
    cb(allowed ? null : new Error('文件扩展名与类型不匹配或不受支持'), !!allowed);
  },
});

function safeAttachmentPath(storedName) {
  if (!storedName || storedName.includes('..') || storedName.includes('\0')) return null;
  const value = resolve(join(attachmentDir, storedName));
  return value.startsWith(`${attachmentRoot}\\`) || value.startsWith(`${attachmentRoot}/`) ? value : null;
}

function saveAttachment(req, res, project, role) {
  if (!req.file) return res.status(400).json({ error: '请选择文件' });
  const count = db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(size),0) AS total FROM service_project_attachments WHERE service_project_id=? AND deleted_at IS NULL').get(project.id);
  if (count.c >= 30 || count.total + req.file.size > 200 * 1024 * 1024) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({ error: '项目附件已达到 30 个或 200MB 上限' });
  }
  const ext = extname(req.file.originalname).toLowerCase();
  const signatures = ext === '.pdf' ? [FILE_SIGNATURES.pdf]
    : ['.docx', '.xlsx', '.zip'].includes(ext) ? [FILE_SIGNATURES.docx]
      : ext === '.png' ? [FILE_SIGNATURES.png]
        : ['.jpg', '.jpeg'].includes(ext) ? [FILE_SIGNATURES.jpeg] : null;
  if (signatures && !checkFileSignature(req.file.path, signatures)) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({ error: '文件内容与扩展名不匹配' });
  }
  const bytes = fs.readFileSync(req.file.path);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const info = db.prepare(
    `INSERT INTO service_project_attachments
     (service_project_id, uploaded_by, role, original_name, stored_name, mime_type, size, sha256)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(project.id, req.user.id, role, String(req.file.originalname).slice(0, 240), req.file.filename, req.file.mimetype || 'application/octet-stream', req.file.size, sha256);
  res.json({ ok: true, id: info.lastInsertRowid });
}

const router = Router();
router.use(authRequired);

router.get('/', (req, res) => res.json({ projects: listServiceProjects({ userId: req.user.id }) }));

router.get('/:id', (req, res) => {
  const project = getServiceProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: '服务项目不存在' });
  res.json({ project });
});

router.post('/:id/submissions', (req, res) => {
  const project = getServiceProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: '服务项目不存在' });
  const { kind, content, idempotency_key } = req.body || {};
  try {
    addSubmission(project, req.user.id, kind, content, idempotency_key);
    res.json({ ok: true, project: getServiceProject(project.id, req.user.id) });
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});

router.post('/:id/attachments', upload.single('file'), (req, res) => {
  const project = getServiceProject(req.params.id, req.user.id);
  if (!project) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
    return res.status(404).json({ error: '服务项目不存在' });
  }
  saveAttachment(req, res, project, 'supplement');
});

router.get('/:id/attachments/:attachmentId', (req, res) => {
  const project = getServiceProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: '服务项目不存在' });
  const file = db.prepare('SELECT * FROM service_project_attachments WHERE id=? AND service_project_id=? AND deleted_at IS NULL').get(req.params.attachmentId, project.id);
  const path = safeAttachmentPath(file?.stored_name);
  if (!file || !path || !fs.existsSync(path)) return res.status(404).json({ error: '附件不存在' });
  res.download(path, file.original_name);
});

router.get('/promotion/validate/:code', (req, res) => {
  try {
    const row = resolvePromotion(req.params.code);
    res.json({ valid: true, code: row.code, partner_name: row.partner_name });
  } catch (err) { res.status(400).json({ valid: false, error: err.message }); }
});

export function createServiceProjectStaffRouter() {
  const staff = Router();
  staff.use(supportRequired);
  staff.get('/', (req, res) => res.json({ projects: listServiceProjects({ status: req.query.status, serviceType: req.query.service_type, q: req.query.q }) }));
  staff.get('/:id', (req, res) => {
    const project = getServiceProject(req.params.id);
    if (!project) return res.status(404).json({ error: '服务项目不存在' });
    const internal = db.prepare('SELECT internal_note FROM service_projects WHERE id=?').get(project.id);
    res.json({ project: { ...project, internal_note: internal?.internal_note || '' } });
  });
  staff.put('/:id', (req, res) => {
    try {
      const project = updateServiceProject(req.params.id, {
        expectedVersion: req.body?.expected_version,
        status: req.body?.status,
        progress: req.body?.progress,
        stage: req.body?.stage,
        nextAction: req.body?.next_action,
        etaAt: req.body?.eta_at,
        note: req.body?.user_visible_note,
        internalNote: req.body?.internal_note,
        scopeSummary: req.body?.scope_summary,
        estimatedHours: req.body?.estimated_hours,
        actualHours: req.body?.actual_hours,
        internalCostCents: req.body?.internal_cost_cents,
        operatorId: req.user.id,
        operatorRole: req.user.is_admin ? 'admin' : 'support',
        idempotencyKey: req.body?.idempotency_key,
      });
      res.json({ ok: true, project });
    } catch (err) { res.status(err.status || 400).json({ error: err.message, code: err.code }); }
  });
  staff.post('/:id/attachments', upload.single('file'), (req, res) => {
    const project = getServiceProject(req.params.id);
    if (!project) {
      if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
      return res.status(404).json({ error: '服务项目不存在' });
    }
    saveAttachment(req, res, project, 'deliverable');
  });
  return staff;
}

export function createPromotionAdminRouter() {
  const admin = Router();
  admin.use(adminRequired);
  admin.get('/', (_req, res) => {
    const partners = promotionPartnerStats();
    const codes = promotionStats();
    res.json({ partners, codes });
  });
  admin.post('/partners', (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: '请填写推广方名称' });
    const commissionPercent = Number(req.body?.commission_percent || 0);
    const holdDays = Number(req.body?.settlement_hold_days ?? 7);
    if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 50) return res.status(400).json({ error: '佣金比例须为 0-50%' });
    if (!Number.isInteger(holdDays) || holdDays < 0 || holdDays > 90) return res.status(400).json({ error: '结算冻结期须为 0-90 天整数' });
    const info = db.prepare('INSERT INTO promotion_partners (name, contact, note, commission_bps, settlement_hold_days) VALUES (?, ?, ?, ?, ?)')
      .run(name, String(req.body?.contact || '').trim().slice(0, 200), String(req.body?.note || '').trim().slice(0, 500), Math.round(commissionPercent * 100), holdDays);
    res.json({ ok: true, id: info.lastInsertRowid });
  });
  admin.post('/codes', (req, res) => {
    const code = normalizePromotionCode(req.body?.code);
    const partnerId = Number(req.body?.partner_id);
    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) return res.status(400).json({ error: '推广码须为 3-32 位字母、数字、下划线或短横线' });
    const partner = db.prepare('SELECT id, is_active FROM promotion_partners WHERE id=?').get(partnerId);
    if (!partner) return res.status(404).json({ error: '推广方不存在' });
    if (!partner.is_active) return res.status(409).json({ error: '推广方已停用，不能新增推广码' });
    try {
      const info = db.prepare('INSERT INTO promotion_codes (code, partner_id, valid_from, valid_until) VALUES (?, ?, ?, ?)').run(code, partnerId, req.body?.valid_from || null, req.body?.valid_until || null);
      res.json({ ok: true, id: info.lastInsertRowid });
    } catch (err) { res.status(409).json({ error: '推广码已存在' }); }
  });
  admin.put('/codes/:id', (req, res) => {
    if (typeof req.body?.is_active !== 'boolean') return res.status(400).json({ error: 'is_active 必须是布尔值' });
    const active = req.body?.is_active ? 1 : 0;
    const result = db.prepare('UPDATE promotion_codes SET is_active=?, updated_at=strftime(\'%s\',\'now\') WHERE id=?').run(active, req.params.id);
    if (!result.changes) return res.status(404).json({ error: '推广码不存在' });
    res.json({ ok: true });
  });
  admin.put('/partners/:id', (req, res) => {
    try {
      if (typeof req.body?.is_active !== 'boolean') return res.status(400).json({ error: 'is_active 必须是布尔值' });
      setPromotionPartnerActive(req.params.id, req.body.is_active);
      res.json({ ok: true });
    } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
  });
  admin.patch('/partners/:id/terms', (req, res) => {
    const commissionPercent = Number(req.body?.commission_percent);
    const holdDays = Number(req.body?.settlement_hold_days);
    if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 50) return res.status(400).json({ error: '佣金比例须为 0-50%' });
    if (!Number.isInteger(holdDays) || holdDays < 0 || holdDays > 90) return res.status(400).json({ error: '结算冻结期须为 0-90 天整数' });
    const result = db.prepare("UPDATE promotion_partners SET commission_bps=?, settlement_hold_days=?, updated_at=strftime('%s','now') WHERE id=?")
      .run(Math.round(commissionPercent * 100), holdDays, req.params.id);
    if (!result.changes) return res.status(404).json({ error: '推广方不存在' });
    res.json({ ok: true });
  });
  const verifyDestructiveRequest = async (req, res, expected) => {
    if (String(req.body?.confirmation || '') !== expected) {
      res.status(400).json({ error: `请输入 ${expected} 进行确认` });
      return false;
    }
    const adminUser = db.prepare('SELECT password_hash FROM users WHERE id=? AND is_admin=1').get(req.user.id);
    if (!adminUser || !await verifyPassword(String(req.body?.admin_password || ''), adminUser.password_hash)) {
      res.status(403).json({ error: '管理员密码错误' });
      return false;
    }
    return true;
  };
  admin.delete('/codes/:id', async (req, res) => {
    try {
      if (!await verifyDestructiveRequest(req, res, `DELETE CODE ${req.params.id}`)) return;
      deletePromotionCode(req.params.id); res.json({ ok: true });
    }
    catch (err) { res.status(err.status || 400).json({ error: err.message }); }
  });
  admin.delete('/partners/:id', async (req, res) => {
    try {
      if (!await verifyDestructiveRequest(req, res, `DELETE PARTNER ${req.params.id}`)) return;
      deletePromotionPartner(req.params.id); res.json({ ok: true });
    }
    catch (err) { res.status(err.status || 400).json({ error: err.message }); }
  });
  return admin;
}

export default router;

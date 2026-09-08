import crypto from 'crypto';
import fs from 'fs';
import { dirname, extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { Router } from 'express';
import db from '../db.js';
import { adminRequired, authRequired, supportRequired } from '../middleware.js';
import { checkFileSignature, FILE_SIGNATURES } from '../utils.js';
import {
  addSubmission, getServiceProject, listServiceProjects, normalizePromotionCode,
  promotionStats, resolvePromotion, updateServiceProject,
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
    const partners = db.prepare('SELECT * FROM promotion_partners ORDER BY id DESC').all();
    const codes = promotionStats();
    res.json({ partners, codes });
  });
  admin.post('/partners', (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: '请填写推广方名称' });
    const info = db.prepare('INSERT INTO promotion_partners (name, contact, note) VALUES (?, ?, ?)').run(name, String(req.body?.contact || '').trim().slice(0, 200), String(req.body?.note || '').trim().slice(0, 500));
    res.json({ ok: true, id: info.lastInsertRowid });
  });
  admin.post('/codes', (req, res) => {
    const code = normalizePromotionCode(req.body?.code);
    const partnerId = Number(req.body?.partner_id);
    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) return res.status(400).json({ error: '推广码须为 3-32 位字母、数字、下划线或短横线' });
    if (!db.prepare('SELECT id FROM promotion_partners WHERE id=?').get(partnerId)) return res.status(404).json({ error: '推广方不存在' });
    try {
      const info = db.prepare('INSERT INTO promotion_codes (code, partner_id, valid_from, valid_until) VALUES (?, ?, ?, ?)').run(code, partnerId, req.body?.valid_from || null, req.body?.valid_until || null);
      res.json({ ok: true, id: info.lastInsertRowid });
    } catch (err) { res.status(409).json({ error: '推广码已存在' }); }
  });
  admin.put('/codes/:id', (req, res) => {
    const active = req.body?.is_active ? 1 : 0;
    const result = db.prepare('UPDATE promotion_codes SET is_active=?, updated_at=strftime(\'%s\',\'now\') WHERE id=?').run(active, req.params.id);
    if (!result.changes) return res.status(404).json({ error: '推广码不存在' });
    res.json({ ok: true });
  });
  return admin;
}

export default router;

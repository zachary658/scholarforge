// 用户生成文档路由：列表 / 下载 / 删除
import { Router } from 'express';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, relative, isAbsolute } from 'path';
import fs from 'fs';
import { authRequired } from '../middleware.js';
import db from '../db.js';
import { getSetting } from '../config-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsDir = join(__dirname, '..', '..', 'uploads', 'docs');
const docsRoot = resolve(docsDir);

const router = Router();

// 安全拼接文件路径：校验解析后的绝对路径仍在 docsDir 下，防路径遍历
function safeFilePath(storedPath) {
  if (!storedPath || typeof storedPath !== 'string') return null;
  if (storedPath.includes('..') || storedPath.includes('\0')) return null;
  const abs = resolve(join(docsDir, storedPath));
  // relative() 跨平台处理 Windows \\ 与 Linux / 分隔符；避免硬编码 '/' 导致 Windows 下载全部失败。
  const rel = relative(docsRoot, abs);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return abs;
}

// 我的文档列表
router.get('/', authRequired, (req, res) => {
  const projectId = Number.parseInt(req.query.projectId, 10);
  const where = Number.isInteger(projectId) && projectId > 0
    ? 'WHERE user_id = ? AND project_id = ?'
    : 'WHERE user_id = ?';
  const params = Number.isInteger(projectId) && projectId > 0 ? [req.user.id, projectId] : [req.user.id];
  const items = db.prepare(
    `SELECT id, project_id, title, feature, order_id, created_at
     FROM generated_docs
     ${where}
     ORDER BY id DESC LIMIT 200`
  ).all(...params);
  // 文档保留天数（供前端提示用户及时下载）
  const retention_days = parseInt(getSetting('doc_retention_days', '30'), 10) || 30;
  res.json({
    docs: items.map((d) => ({
      ...d,
      download_url: `/api/docs/download/${d.id}`,
    })),
    retention_days,
  });
});

// 下载文档
router.get('/download/:id', authRequired, (req, res) => {
  const doc = db.prepare('SELECT * FROM generated_docs WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!doc) return res.status(404).json({ error: '文档不存在' });
  const filePath = safeFilePath(doc.file_path);
  if (!filePath) return res.status(400).json({ error: '文件路径非法' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件已被清理' });
  // 增加 download 头，按实际文件类型给出扩展名（.docx / .pptx）
  const ext = /\.pptx$/i.test(doc.file_path) ? '.pptx' : '.docx';
  const safeName = (doc.title || doc.file_path).replace(/[^\w\u4e00-\u9fa5.-]/g, '_');
  res.download(filePath, `${safeName}${ext}`);
});

// 删除文档
router.delete('/:id', authRequired, (req, res) => {
  const doc = db.prepare('SELECT * FROM generated_docs WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!doc) return res.status(404).json({ error: '文档不存在' });
  const filePath = safeFilePath(doc.file_path);
  if (filePath) {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }
  db.prepare('DELETE FROM generated_docs WHERE id = ?').run(doc.id);
  res.json({ ok: true });
});

export default router;

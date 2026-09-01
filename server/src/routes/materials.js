// 用户写作资料：上传（docx/pdf/txt 解读）/ 列表 / 删除
// 资料解读后存储文本与 token 量，供生成时注入上下文；材料解读 token 计入订单费用
import { Router } from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import { authRequired } from '../middleware.js';
import { makeLimiter } from '../middleware/rateLimit.js';
import db from '../db.js';
import { estimateTextTokens } from '../services/billing.js';
import { parsePdfViaPdfjs } from '../services/paper-distillation.js';
import { isProjectOwned } from '../services/task-store.js';
import { FILE_SIGNATURES } from '../utils.js';
import logger from '../logger.js';

const router = Router();
router.use(authRequired);

// 大小与文本长度限制（防超大材料撑爆 DB 与上下文）
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_TEXT_CHARS = 100000; // 解读文本最多 10 万字符
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES } });

// 上传解读为 CPU 密集操作（docx/pdf 解析）：每用户每分钟最多 20 次
// authRequired 已在本路由顶部 router.use 挂载，先于限流执行，keyType 'user' 可取到 req.user
const uploadLimiter = makeLimiter({ keyType: 'user', max: 20, windowMs: 60 * 1000 });

// 按扩展名解析文件为纯文本
async function extractText(buffer, filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  if (ext === 'txt' || ext === 'md') {
    return buffer.toString('utf8');
  }
  if (ext === 'docx') {
    const res = await mammoth.extractRawText({ buffer });
    return res.value || '';
  }
  if (ext === 'pdf') {
    const lines = await parsePdfViaPdfjs(buffer);
    return lines.join('\n');
  }
  throw new Error('仅支持 .docx / .pdf / .txt 格式');
}

// magic-byte 校验：扩展名可伪造，按文件头拦截伪装文件
// docx（ZIP 容器）前 4 字节 PK\x03\x04；pdf 开头 %PDF；txt/md 为纯文本无文件头，跳过
function checkFileMagic(buffer, ext) {
  if (ext === 'docx') return buffer.subarray(0, 4).equals(FILE_SIGNATURES.docx);
  if (ext === 'pdf') return buffer.subarray(0, 4).equals(FILE_SIGNATURES.pdf);
  return true;
}

// 上传并解读资料（含 token 估算；解读 token 量在生成下单时计入费用）
router.post('/upload', uploadLimiter, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择文件' });
  const projectId = req.body.projectId ? parseInt(req.body.projectId, 10) : null;
  // 安全：校验工作区归属（防跨用户关联）
  if (projectId && !isProjectOwned(req.user.id, projectId)) {
    return res.status(403).json({ error: '无权访问该工作区' });
  }
  // magic-byte 校验：读文件头（前 8 字节内比对签名），不符直接 400 中文提示，
  // 防伪造扩展名的伪装文件进入解析流程（泄露解析器内部错误或拖垮解析服务）
  const ext = (req.file.originalname || '').split('.').pop().toLowerCase();
  if (!checkFileMagic(req.file.buffer, ext)) {
    return res.status(400).json({ error: '文件内容与扩展名不符，请上传真实的 .docx / .pdf 文档' });
  }
  try {
    const text = await extractText(req.file.buffer, req.file.originalname);
    if (!text.trim()) return res.status(400).json({ error: '未能从文件中提取到文本内容' });
    if (text.length > MAX_TEXT_CHARS) {
      return res.status(400).json({ error: `材料内容过长（最多 ${MAX_TEXT_CHARS} 字符，当前 ${text.length}）` });
    }
    const tokens = estimateTextTokens(text);
    const name = String(req.body.name || req.file.originalname).trim().slice(0, 200);
    const info = db.prepare(
      `INSERT INTO materials (user_id, project_id, name, file_type, text_content, tokens) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(req.user.id, projectId, name || req.file.originalname, (req.file.originalname || '').split('.').pop().toLowerCase(), text, tokens);
    res.json({
      ok: true,
      id: info.lastInsertRowid,
      name,
      tokens,
      chars: text.length,
      projectId,
    });
  } catch (err) {
    logger.warn('materials', `资料解读失败: ${err.message}`);
    res.status(400).json({ error: '资料解读失败：' + err.message });
  }
});

// 我的资料列表（可按工作区筛选；不含全文文本，仅元信息）
router.get('/', (req, res) => {
  const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
  let rows;
  if (projectId) {
    // 校验归属
    if (!isProjectOwned(req.user.id, projectId)) return res.status(403).json({ error: '无权访问该工作区' });
    rows = db.prepare('SELECT id, name, file_type, tokens, project_id, created_at FROM materials WHERE user_id = ? AND project_id = ? ORDER BY id DESC').all(req.user.id, projectId);
  } else {
    rows = db.prepare('SELECT id, name, file_type, tokens, project_id, created_at FROM materials WHERE user_id = ? ORDER BY id DESC LIMIT 200').all(req.user.id);
  }
  res.json({ materials: rows });
});

// 删除资料
router.delete('/:id', (req, res) => {
  const m = db.prepare('SELECT id FROM materials WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!m) return res.status(404).json({ error: '资料不存在' });
  db.prepare('DELETE FROM materials WHERE id = ?').run(m.id);
  res.json({ ok: true });
});

export default router;

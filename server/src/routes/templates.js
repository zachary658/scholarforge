// 用户模板路由：上传 / 列表 / 删除
import { Router } from 'express';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';
import fs from 'fs';
import { authRequired } from '../middleware.js';
import db from '../db.js';
import { parseTemplate, describeStyles } from '../services/template-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(__dirname, '..', '..', 'uploads', 'templates');
if (!fs.existsSync(templatesDir)) fs.mkdirSync(templatesDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, templatesDir),
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase();
      const safe = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
      cb(null, safe);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.docx')) {
      return cb(new Error('仅支持 .docx 格式模板文件'));
    }
    cb(null, true);
  },
});

const router = Router();

// 我的模板 + 全局模板列表
router.get('/', authRequired, (req, res) => {
  const items = db.prepare(
    `SELECT id, user_id, name, file_path, styles_json, is_global, created_at
     FROM templates
     WHERE user_id = ? OR is_global = 1
     ORDER BY is_global DESC, id DESC`
  ).all(req.user.id);
  res.json({
    templates: items.map((t) => {
      let styles = {};
      try { styles = JSON.parse(t.styles_json || '{}'); } catch { styles = {}; }
      return {
        ...t,
        styles_json: undefined,
        styles,
        style_desc: describeStyles(styles),
        is_mine: t.user_id === req.user.id,
      };
    }),
  });
});

// 上传模板
router.post('/upload', authRequired, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: '请上传 .docx 文件' });
    const name = (req.body.name || req.file.originalname).toString().slice(0, 100);
    const filePath = req.file.path;

    try {
      const result = await parseTemplate(filePath);
      if (!result.ok) {
        fs.unlink(filePath, () => {});
        return res.status(400).json({ error: result.error || '模板解析失败' });
      }

      const stylesJson = JSON.stringify(result.styles);
      const info = db.prepare(
        `INSERT INTO templates (user_id, name, file_path, styles_json, is_global) VALUES (?, ?, ?, ?, 0)`
      ).run(req.user.id, name, req.file.filename, stylesJson);

      const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(info.lastInsertRowid);
      res.json({
        ok: true,
        template: {
          ...t,
          styles: result.styles,
          style_desc: describeStyles(result.styles),
        },
      });
    } catch (err) {
      fs.unlink(filePath, () => {});
      res.status(400).json({ error: '模板解析失败：' + err.message });
    }
  });
});

// 删除模板（仅本人）
router.delete('/:id', authRequired, (req, res) => {
  const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '模板不存在' });
  if (t.user_id !== req.user.id) return res.status(403).json({ error: '无权删除' });
  // 删文件
  try { fs.unlinkSync(join(templatesDir, t.file_path)); } catch { /* ignore */ }
  db.prepare('DELETE FROM templates WHERE id = ?').run(t.id);
  res.json({ ok: true });
});

export default router;

import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../middleware.js';

const router = Router();

router.get('/', authRequired, (req, res) => {
  const docs = db
    .prepare('SELECT id, title, tool_type, content, created_at, updated_at FROM documents WHERE user_id = ? ORDER BY updated_at DESC')
    .all(req.user.id);
  res.json({ documents: docs });
});

router.post('/', authRequired, (req, res) => {
  const { title, tool_type, content } = req.body || {};
  if (!title) return res.status(400).json({ error: '请填写文档标题' });
  if (!tool_type) return res.status(400).json({ error: '缺少工具类型' });
  const info = db
    .prepare('INSERT INTO documents (user_id, title, tool_type, content) VALUES (?, ?, ?, ?)')
    .run(req.user.id, title, tool_type, content || '');
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(info.lastInsertRowid);
  res.json({ document: doc });
});

router.put('/:id', authRequired, (req, res) => {
  const { title, content } = req.body || {};
  const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!doc) return res.status(404).json({ error: '文档不存在' });
  db.prepare('UPDATE documents SET title = ?, content = ?, updated_at = strftime(\'%s\',\'now\') WHERE id = ?')
    .run(title ?? doc.title, content ?? doc.content, doc.id);
  const updated = db.prepare('SELECT * FROM documents WHERE id = ?').get(doc.id);
  res.json({ document: updated });
});

router.delete('/:id', authRequired, (req, res) => {
  const doc = db.prepare('SELECT id FROM documents WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!doc) return res.status(404).json({ error: '文档不存在' });
  db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
  res.json({ ok: true });
});

export default router;

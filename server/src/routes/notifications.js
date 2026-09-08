import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../middleware.js';
import { now } from '../utils.js';

const router = Router();
router.use(authRequired);

router.get('/', (req, res) => {
  const notifications = db.prepare(
    'SELECT id, type, title, content, link, read_at, created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100'
  ).all(req.user.id);
  const unread = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id=? AND read_at IS NULL').get(req.user.id).c;
  res.json({ notifications, unread });
});

router.put('/:id/read', (req, res) => {
  const result = db.prepare('UPDATE notifications SET read_at=COALESCE(read_at, ?) WHERE id=? AND user_id=?').run(now(), req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: '通知不存在' });
  res.json({ ok: true });
});

router.put('/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(now(), req.user.id);
  res.json({ ok: true });
});

export default router;

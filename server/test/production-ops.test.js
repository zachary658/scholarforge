import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-prod-ops-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-longer-than-thirty-two-characters';
process.env.TOTP_ENCRYPTION_KEY = 'test-totp-key-that-is-longer-than-thirty-two-characters';

const db = (await import('../src/db.js')).default;
const { adminAuditMiddleware } = await import('../src/services/admin-audit.js');
const { beginTotpEnrollment, confirmTotpEnrollment, totpCode, verifyStaffSecondFactor } = await import('../src/services/totp.js');
const { runScheduledBackup } = await import('../src/services/backup-scheduler.js');

test('后台写操作审计保存操作者、脱敏请求和前后快照', async () => {
  const userId = db.prepare("INSERT INTO users (email,password_hash,name,is_admin) VALUES ('audit@example.com','x','审计员',1)").run().lastInsertRowid;
  const courseId = db.prepare("INSERT INTO courses (title,price) VALUES ('原课程',10)").run().lastInsertRowid;
  const req = {
    method: 'PUT', path: `/courses/${courseId}`, baseUrl: '/api/admin', params: {},
    body: { title: '新课程', api_key: 'must-not-leak' },
    headers: { 'user-agent': 'test-agent', 'x-request-id': 'req-1' }, ip: '127.0.0.1',
    user: { id: userId, email: 'audit@example.com', is_admin: true },
  };
  const res = new EventEmitter();
  res.statusCode = 200;
  res.json = (value) => value;
  await new Promise((resolve) => {
    adminAuditMiddleware(req, res, () => {
      db.prepare('UPDATE courses SET title = ? WHERE id = ?').run('新课程', courseId);
      res.json({ ok: true, id: courseId });
      res.emit('finish');
      resolve();
    });
  });
  const row = db.prepare('SELECT * FROM admin_operation_logs ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.actor_id, userId);
  assert.equal(row.target_type, 'course');
  assert.match(row.before_json, /原课程/);
  assert.match(row.after_json, /新课程/);
  assert.doesNotMatch(row.request_json, /must-not-leak/);
  assert.match(row.request_json, /redacted/);
  assert.match(row.entry_hash, /^[a-f0-9]{64}$/);
});

test('TOTP 启用后校验动态码，并支持一次性恢复码', () => {
  const userId = db.prepare("INSERT INTO users (email,password_hash,name,is_support) VALUES ('support@example.com','x','客服',1)").run().lastInsertRowid;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const enrollment = beginTotpEnrollment(user);
  const recoveryCodes = confirmTotpEnrollment(userId, totpCode(enrollment.secret));
  assert.equal(recoveryCodes.length, 10);
  const enabled = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  assert.equal(verifyStaffSecondFactor(enabled, totpCode(enrollment.secret)), true);
  assert.equal(verifyStaffSecondFactor(enabled, recoveryCodes[0]), true);
  assert.equal(verifyStaffSecondFactor(enabled, recoveryCodes[0]), false, '恢复码只能使用一次');
});

test('自动备份生成可打开快照并清理过期快照', async () => {
  const backupDir = path.join(tmpDir, 'scheduled-backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const old = path.join(backupDir, 'scholarforge-20000101000000.db');
  fs.writeFileSync(old, 'old');
  fs.utimesSync(old, new Date(0), new Date(0));
  const result = await runScheduledBackup({ outputDir: backupDir, retentionDays: 1 });
  assert.equal(fs.existsSync(result.destination), true);
  assert.equal(fs.existsSync(old), false);
  assert.equal(result.removed, 1);
});

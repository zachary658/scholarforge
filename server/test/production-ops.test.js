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
const { getSecureSetting, migrateLegacySecureSettings, setSecureSetting } = await import('../src/services/secure-settings.js');
const { getConfiguredModel, getModels, setSetting } = await import('../src/config-store.js');
const { buildPasswordResetEmail, getMailConfigStatus } = await import('../src/services/mailer.js');

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

test('敏感配置只保存密文，模型运行时可读取但管理状态不泄露 Key', () => {
  const secret = 'sk-test-value-that-must-never-appear-in-database';
  setSecureSetting('llm_api_key_deepseek', secret, null);
  const row = db.prepare("SELECT encrypted_value FROM secure_settings WHERE key='llm_api_key_deepseek'").get();
  assert.ok(row.encrypted_value.startsWith('v1.'));
  assert.doesNotMatch(row.encrypted_value, /sk-test-value/);
  assert.equal(getSecureSetting('llm_api_key_deepseek'), secret);
  assert.equal(getConfiguredModel('deepseek').api_key, secret);
  const adminPayload = JSON.stringify(getModels());
  assert.doesNotMatch(adminPayload, /sk-test-value/);
  assert.match(adminPayload, /admin_vault/);
});

test('历史 settings 明文密钥自动迁移并删除明文副本', () => {
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('yidun_secret_key','legacy-secret-value')").run();
  assert.equal(migrateLegacySecureSettings(), 1);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='yidun_secret_key'").get(), undefined);
  assert.equal(getSecureSetting('yidun_secret_key'), 'legacy-secret-value');
});

test('后台邮件配置即时生效，SMTP 凭据只返回状态且保持密文', () => {
  const smtp = 'smtps://mailer:encoded-password@smtp.example.com:465';
  setSecureSetting('smtp_url', smtp, null);
  setSetting('mail_from', 'ScholarForge <noreply@example.com>');
  setSetting('frontend_url', 'https://scholarforge.example');
  const stored = db.prepare("SELECT encrypted_value FROM secure_settings WHERE key='smtp_url'").get();
  assert.doesNotMatch(stored.encrypted_value, /encoded-password|smtp\.example/);
  const status = getMailConfigStatus();
  assert.equal(status.configured, true);
  assert.equal(status.smtp_source, 'admin_vault');
  assert.equal('smtp_url' in status, false);
  assert.match(buildPasswordResetEmail('user@qq.com', 'reset-token').text, /https:\/\/scholarforge\.example\/reset-password/);
});

test('邮件配置审计不会记录 SMTP 用户名或密码', async () => {
  const admin = db.prepare("SELECT * FROM users WHERE email='audit@example.com'").get();
  const req = { method: 'PUT', path: '/email-config', baseUrl: '/api/admin', params: {}, body: { smtp_url: 'smtps://mailer:top-secret@smtp.example.com:465', admin_password: 'password' }, headers: {}, ip: '127.0.0.1', user: { ...admin, is_admin: true } };
  const res = new EventEmitter(); res.statusCode = 200; res.json = (value) => value;
  await new Promise((resolve) => adminAuditMiddleware(req, res, () => { res.json({ ok: true }); res.emit('finish'); resolve(); }));
  const row = db.prepare('SELECT request_json FROM admin_operation_logs ORDER BY id DESC LIMIT 1').get();
  const request = JSON.parse(row.request_json);
  assert.equal(request.smtp_url, '***redacted***');
  assert.equal(request.admin_password, '***redacted***');
  assert.doesNotMatch(row.request_json, /top-secret|smtp\.example|mailer/);
});

test('运行密钥审计不会记录通用 value 字段的明文', async () => {
  const admin = db.prepare("SELECT * FROM users WHERE email='audit@example.com'").get();
  const req = { method: 'PUT', path: '/secure-config/alert_webhook_url', baseUrl: '/api/admin', params: {}, body: { value: 'https://secret.example/hook-token', admin_password: 'password' }, headers: {}, ip: '127.0.0.1', user: { ...admin, is_admin: true } };
  const res = new EventEmitter(); res.statusCode = 200; res.json = (value) => value;
  await new Promise((resolve) => adminAuditMiddleware(req, res, () => { res.json({ ok: true }); res.emit('finish'); resolve(); }));
  const row = db.prepare('SELECT request_json FROM admin_operation_logs ORDER BY id DESC LIMIT 1').get();
  const request = JSON.parse(row.request_json);
  assert.equal(request.value, '***redacted***');
  assert.equal(request.admin_password, '***redacted***');
  assert.doesNotMatch(row.request_json, /hook-token|https:\/\/secret\.example/);
  assert.match(row.request_json, /redacted/);
});

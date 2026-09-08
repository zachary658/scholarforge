import crypto from 'crypto';
import db from '../db.js';

export const SECURE_SETTING_KEYS = new Set([
  'alipay_private_key', 'alipay_private_key_path', 'alipay_public_key', 'alipay_public_key_path',
  'wechat_api_v3_key', 'wechat_private_key', 'wechat_private_key_path',
  'wechat_platform_public_key', 'wechat_platform_public_key_path',
  'aliyun_access_key_secret', 'yidun_secret_key',
  'alert_webhook_url', 'totp_encryption_key', 'smtp_url',
  'llm_api_key_deepseek', 'llm_api_key_qwen', 'llm_api_key_zhipu',
  'llm_api_key_kimi', 'llm_api_key_openai',
]);

function rootKey() {
  const source = process.env.CONFIG_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!source || source.length < 32) {
    throw Object.assign(new Error('敏感配置保险箱不可用：请配置至少 32 字符的 CONFIG_ENCRYPTION_KEY 或 JWT_SECRET'), { statusCode: 503 });
  }
  return crypto.hkdfSync('sha256', Buffer.from(source), Buffer.from('scholarforge-secure-settings'), Buffer.from('aes-256-gcm-v1'), 32);
}

function assertAllowed(key) {
  if (!SECURE_SETTING_KEYS.has(key)) throw Object.assign(new Error('不允许写入该敏感配置'), { statusCode: 400 });
}

function encrypt(key, value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', rootKey(), iv);
  cipher.setAAD(Buffer.from(key));
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decrypt(key, payload) {
  const [version, iv, tag, ciphertext] = String(payload || '').split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error(`敏感配置 ${key} 数据损坏`);
  const decipher = crypto.createDecipheriv('aes-256-gcm', rootKey(), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(key));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

export function getSecureSetting(key, fallback = '') {
  assertAllowed(key);
  const row = db.prepare('SELECT encrypted_value FROM secure_settings WHERE key = ?').get(key);
  return row ? decrypt(key, row.encrypted_value) : fallback;
}

export function hasSecureSetting(key) {
  assertAllowed(key);
  return Boolean(db.prepare('SELECT 1 FROM secure_settings WHERE key = ?').get(key));
}

export function setSecureSetting(key, value, updatedBy = null) {
  assertAllowed(key);
  const normalized = String(value || '').trim();
  if (!normalized) throw Object.assign(new Error('敏感配置值不能为空'), { statusCode: 400 });
  db.prepare(`INSERT INTO secure_settings (key, encrypted_value, updated_by, version, updated_at)
    VALUES (?, ?, ?, 1, strftime('%s','now'))
    ON CONFLICT(key) DO UPDATE SET encrypted_value=excluded.encrypted_value,
      updated_by=excluded.updated_by, version=secure_settings.version+1, updated_at=excluded.updated_at`)
    .run(key, encrypt(key, normalized), updatedBy);
}

export function deleteSecureSetting(key) {
  assertAllowed(key);
  return db.prepare('DELETE FROM secure_settings WHERE key = ?').run(key).changes > 0;
}

export function migrateLegacySecureSettings() {
  const migrate = db.transaction(() => {
    let count = 0;
    for (const key of SECURE_SETTING_KEYS) {
      const legacy = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      if (!legacy?.value) continue;
      if (!hasSecureSetting(key)) setSecureSetting(key, legacy.value, null);
      db.prepare('DELETE FROM settings WHERE key = ?').run(key);
      count += 1;
    }
    return count;
  });
  return migrate();
}

export function getSecureSettingStatuses() {
  const rows = new Map(db.prepare('SELECT key, version, updated_at FROM secure_settings').all().map((row) => [row.key, row]));
  return Object.fromEntries([...SECURE_SETTING_KEYS].map((key) => [key, {
    configured: rows.has(key), version: rows.get(key)?.version || 0, updated_at: rows.get(key)?.updated_at || null,
  }]));
}

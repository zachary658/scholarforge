import crypto from 'crypto';
import db from '../db.js';
import { getSecureSetting } from './secure-settings.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;

function encryptionKey() {
  const configured = process.env.TOTP_ENCRYPTION_KEY || getSecureSetting('totp_encryption_key', '');
  if (process.env.NODE_ENV === 'production' && !configured) {
    throw Object.assign(new Error('请先配置独立的 TOTP_ENCRYPTION_KEY'), { statusCode: 503 });
  }
  const source = configured || process.env.JWT_SECRET;
  if (!source || (process.env.NODE_ENV === 'production' && source.length < 32)) {
    throw Object.assign(new Error('请先配置至少 32 字符的 TOTP_ENCRYPTION_KEY'), { statusCode: 503 });
  }
  return crypto.createHash('sha256').update(source).digest();
}

function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let result = '';
  for (let i = 0; i < bits.length; i += 5) result += ALPHABET[Number.parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return result;
}

function base32Decode(value) {
  let bits = '';
  for (const char of String(value).replace(/=+$/g, '').toUpperCase()) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('无效 TOTP 密钥');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function encrypt(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decrypt(value) {
  const [iv, tag, payload] = String(value || '').split('.');
  if (!iv || !tag || !payload) throw new Error('TOTP 密钥数据损坏');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(payload, 'base64url')), decipher.final()]).toString('utf8');
}

export function totpCode(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 1000 / STEP_SECONDS);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return String(value).padStart(6, '0');
}

export function verifyTotp(secret, code, timestamp = Date.now()) {
  const normalized = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  return [-1, 0, 1].some((offset) => {
    const expected = totpCode(secret, timestamp + offset * STEP_SECONDS * 1000);
    return crypto.timingSafeEqual(Buffer.from(normalized), Buffer.from(expected));
  });
}

function recoveryHash(userId, code) {
  return crypto.createHmac('sha256', encryptionKey()).update(`${userId}:${String(code).toUpperCase()}`).digest('hex');
}

export function beginTotpEnrollment(user) {
  if (!user?.is_admin && !user?.is_support) throw Object.assign(new Error('仅管理员和客服账号可启用双因素认证'), { statusCode: 403 });
  if (user.totp_enabled_at) throw Object.assign(new Error('双因素认证已启用；如需更换设备，请先验证并关闭后重新设置'), { statusCode: 409 });
  const secret = base32Encode(crypto.randomBytes(20));
  db.prepare('UPDATE users SET totp_secret_enc = ?, totp_enabled_at = NULL WHERE id = ?').run(encrypt(secret), user.id);
  db.prepare('DELETE FROM totp_recovery_codes WHERE user_id = ?').run(user.id);
  const label = encodeURIComponent(`ScholarForge:${user.email}`);
  const issuer = encodeURIComponent('ScholarForge');
  return { secret, otpauth_url: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30` };
}

export function confirmTotpEnrollment(userId, code) {
  const user = db.prepare('SELECT totp_secret_enc FROM users WHERE id = ?').get(userId);
  if (!user?.totp_secret_enc || !verifyTotp(decrypt(user.totp_secret_enc), code)) return null;
  const codes = Array.from({ length: 10 }, () => crypto.randomBytes(5).toString('hex').toUpperCase());
  db.transaction(() => {
    db.prepare('UPDATE users SET totp_enabled_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), userId);
    db.prepare('DELETE FROM totp_recovery_codes WHERE user_id = ?').run(userId);
    const insert = db.prepare('INSERT INTO totp_recovery_codes (user_id, code_hash) VALUES (?, ?)');
    for (const recovery of codes) insert.run(userId, recoveryHash(userId, recovery));
  })();
  return codes;
}

export function verifyStaffSecondFactor(user, code) {
  if (!user?.totp_enabled_at || !user?.totp_secret_enc) return true;
  if (verifyTotp(decrypt(user.totp_secret_enc), code)) return true;
  const hash = recoveryHash(user.id, code);
  const row = db.prepare('SELECT id FROM totp_recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL').get(user.id, hash);
  if (!row) return false;
  return db.prepare('UPDATE totp_recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL').run(Math.floor(Date.now() / 1000), row.id).changes === 1;
}

export function disableTotp(userId) {
  db.transaction(() => {
    db.prepare('UPDATE users SET totp_secret_enc = NULL, totp_enabled_at = NULL WHERE id = ?').run(userId);
    db.prepare('DELETE FROM totp_recovery_codes WHERE user_id = ?').run(userId);
  })();
}

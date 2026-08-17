import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { now } from './utils.js';

import crypto from 'crypto';
import logger from './logger.js';
import db from './db.js';

// JWT 密钥：优先从环境变量读取，否则生成随机密钥并警告
// 生产环境必须设置强随机环境变量，否则启动时退出
const PLACEHOLDER_KEYWORDS = ['your-jwt-secret', 'change-this', 'changeme', 'replace-me'];
const isPlaceholder = (s) => PLACEHOLDER_KEYWORDS.some((kw) => s.toLowerCase().includes(kw));

let JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  if (process.env.NODE_ENV === 'production') {
    logger.error('auth', '生产环境必须设置 JWT_SECRET 环境变量且长度 >= 32 字符，进程退出');
    process.exit(1);
  }
  if (JWT_SECRET) {
    logger.warn('auth', 'JWT_SECRET 长度不足 32 字符，已生成随机密钥替代');
  } else {
    logger.warn('auth', '未设置 JWT_SECRET 环境变量，已生成随机密钥。重启后所有已签发的 token 将失效');
  }
  JWT_SECRET = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
}

if (isPlaceholder(process.env.JWT_SECRET || '')) {
  if (process.env.NODE_ENV === 'production') {
    logger.error('auth', 'JWT_SECRET 包含占位符关键词，生产环境拒绝启动');
    process.exit(1);
  }
  logger.warn('auth', 'JWT_SECRET 包含占位符关键词，已生成随机密钥替代');
  JWT_SECRET = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
}
// jose 需要 Uint8Array 格式的密钥
const secretKey = new TextEncoder().encode(JWT_SECRET);

// access token 短效（15 分钟），refresh token 长效（7 天，可吊销+轮换）
const ACCESS_TOKEN_EXPIRES_IN = '15m';
const REFRESH_TOKEN_EXPIRES_SECONDS = 7 * 24 * 3600; // 7 天
const PASSWORD_RESET_EXPIRES_SECONDS = 30 * 60; // 30 分钟

// 使用异步 bcrypt 避免阻塞事件循环（bcryptjs 同步实现较慢）
export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// ===== Access Token：短效，包含 token_version 用于主动失效 =====
// jose 是异步的，SignJWT 返回 Promise
// 使用显式 HS256 算法，杜绝 alg 混淆攻击
export async function signAccessToken(user) {
  return new SignJWT({
    id: user.id,
    email: user.email,
    name: user.name,
    is_admin: !!user.is_admin,
    is_support: !!user.is_support,
    // token_version 用于主动失效：修改密码/登出时 +1，旧 token 立即失效
    ver: user.token_version || 0,
    type: 'access',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRES_IN)
    .sign(secretKey);
}

export async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, secretKey, { algorithms: ['HS256'] });
    // 仅接受 access token
    if (payload.type && payload.type !== 'access') return null;
    return payload;
  } catch {
    return null;
  }
}

// ===== Refresh Token：长效，存数据库 hash，可吊销+轮换 =====
// 返回明文 token 给客户端，数据库只存 hash（泄露数据库无法直接复用）

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function signRefreshToken(user) {
  // 生成 32 字节随机 refresh token
  const raw = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(raw);
  const expiresAt = now() + REFRESH_TOKEN_EXPIRES_SECONDS;
  db.prepare(
    'INSERT INTO refresh_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)'
  ).run(tokenHash, user.id, expiresAt);
  return raw;
}

// 校验 refresh token：返回 user 或 null
export function verifyRefreshToken(token) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = db.prepare(
    `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at,
            u.email, u.name, u.is_admin, u.status, u.token_version
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = ?`
  ).get(tokenHash);
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at < now()) return null;
  if (row.status === 'banned') return null;
  return {
    id: row.user_id,
    email: row.email,
    name: row.name,
    is_admin: !!row.is_admin,
    token_version: row.token_version || 0,
    _rt_id: row.id,
  };
}

// 轮换 refresh token：旧 token 吊销，发新的（防重放）
export async function rotateRefreshToken(oldToken, user) {
  const tokenHash = hashToken(oldToken);
  // 吊销旧 token
  db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').run(now(), tokenHash);
  // 签发新 token
  const newToken = await signRefreshToken(user);
  return newToken;
}

// 吊销用户所有 refresh token（修改密码 / 重置密码时调用）
export function revokeAllRefreshTokens(userId) {
  db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now(), userId);
}

// 吊销单个 refresh token（登出时仅吊销当前设备，不影响其他设备）
export function revokeRefreshToken(token) {
  if (!token) return;
  const tokenHash = hashToken(token);
  db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').run(now(), tokenHash);
}

// 清理过期的 refresh token / 已使用的密码重置 token（定期调用，防表膨胀）
export function cleanupExpiredTokens() {
  const t = now();
  const r1 = db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ? OR revoked_at IS NOT NULL').run(t);
  const r2 = db.prepare('DELETE FROM password_reset_tokens WHERE expires_at < ? OR used_at IS NOT NULL').run(t);
  return r1.changes + r2.changes;
}

// token_version +1：使所有已签发的 access token 立即失效
export function incrementTokenVersion(userId) {
  db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(userId);
}

// ===== 密码重置：一次性 token，30 分钟有效 =====

export function generatePasswordResetToken(userId) {
  const raw = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(raw);
  const expiresAt = now() + PASSWORD_RESET_EXPIRES_SECONDS;
  // 吊销该用户之前所有未使用的重置 token（避免多个有效 token）
  db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(now(), userId);
  db.prepare(
    'INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)'
  ).run(tokenHash, userId, expiresAt);
  return raw;
}

// 校验密码重置 token：返回 userId 或 null（校验通过后标记已用）
export function consumePasswordResetToken(token) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = db.prepare(
    'SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?'
  ).get(tokenHash);
  if (!row) return null;
  if (row.used_at) return null;
  if (row.expires_at < now()) return null;
  // 标记已用（一次性）
  db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL').run(now(), row.id);
  return row.user_id;
}

// 安全返回用户对象（不含密码）
export function safeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    is_admin: !!user.is_admin,
    is_support: !!user.is_support,
    status: user.status,
    free_quota: user.free_quota || 0,
    free_quota_expires_at: user.free_quota_expires_at || null,
    points: user.points || 0,
    created_at: user.created_at,
  };
}

// 确保存在默认管理员账号
// 安全：始终使用 crypto.randomBytes(16) 生成强密码，不再使用任何占位符
export async function ensureAdminAccount() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@scholarforge.com';
  let adminPassword;

  if (process.env.ADMIN_PASSWORD) {
    if (process.env.ADMIN_PASSWORD.length < 8 || isPlaceholder(process.env.ADMIN_PASSWORD)) {
      if (process.env.NODE_ENV === 'production') {
        logger.warn('auth', 'ADMIN_PASSWORD 过短或为占位符，已忽略并使用随机强密码');
      }
      adminPassword = crypto.randomBytes(16).toString('hex');
    } else {
      adminPassword = process.env.ADMIN_PASSWORD;
    }
  } else {
    adminPassword = crypto.randomBytes(16).toString('hex');
  }

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  if (!exists) {
    const hash = await hashPassword(adminPassword);
    db.prepare('INSERT INTO users (email, password_hash, name, is_admin) VALUES (?, ?, ?, 1)').run(
      adminEmail,
      hash,
      '系统管理员'
    );
    logger.info('admin', `管理员账号已创建：${adminEmail}`);
    if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 8 || isPlaceholder(process.env.ADMIN_PASSWORD)) {
      // 不再打印明文密码到日志，仅提示通过环境变量设置
      logger.info('admin', '未设置有效的 ADMIN_PASSWORD 环境变量，已生成随机强密码');
      logger.info('admin', '如需查看初始密码，请通过 ADMIN_PASSWORD 环境变量重新部署，或联系管理员重置');
    }
  }
}

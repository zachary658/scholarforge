import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import db from '../db.js';
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  rotateRefreshToken,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  incrementTokenVersion,
  generatePasswordResetToken,
  consumePasswordResetToken,
  safeUser,
  setRefreshCookie,
  clearRefreshCookie,
  getRefreshTokenFromCookie,
} from '../auth.js';
import { authRequired } from '../middleware.js';
import { getSetting, getSignupPointsConfig, getSignupGuardConfig, isDisposableEmail } from '../config-store.js';
import { grantPoints } from '../services/billing.js';
import { sendMail, buildPasswordResetEmail } from '../services/mailer.js';
import logger from '../logger.js';

const router = Router();

// 登录速率限制：每个 IP 15 分钟最多 10 次尝试，防暴力破解
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '登录尝试过于频繁，请 15 分钟后再试' },
});

// 注册速率限制：每个 IP 每小时最多 5 次注册，防批量薅额度
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '注册过于频繁，请稍后再试' },
});

// 密码重置请求速率限制：每个 IP 每小时最多 5 次，防邮箱枚举/轰炸
const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' },
});

// 密码强度校验：至少 8 位，必须同时包含字母和数字
function validatePasswordStrength(password) {
  if (!password || password.length < 8) return '密码至少 8 位';
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return '密码必须同时包含字母和数字';
  return null;
}

// 获取客户端真实 IP（依赖 index.js 的 trust proxy 配置；未配置反代时 req.ip 即真实地址）
function getClientIp(req) {
  return (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

// 校验设备指纹格式（防止异常/伪造值污染风控）
function sanitizeDeviceFingerprint(fp) {
  if (typeof fp !== 'string') return null;
  const trimmed = fp.trim();
  // 只接受 16~128 位十六进制/字母数字指纹
  if (!/^[a-f0-9]{16,128}$/i.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

// 注册风控：一次性邮箱 / 同 IP 24h 注册数 / 同设备指纹注册数
// 返回 { ok, error }；ok=true 表示通过
function checkSignupGuard({ email, ip, deviceFingerprint }) {
  // 1. 一次性邮箱拦截
  if (isDisposableEmail(email)) {
    return { ok: false, error: '请使用真实邮箱注册（临时邮箱暂不支持）' };
  }
  const guard = getSignupGuardConfig();
  const nowSec = Math.floor(Date.now() / 1000);

  // 2. 同 IP 24 小时内注册数限制
  if (guard.ipLimit > 0 && ip) {
    const count = db.prepare(
      'SELECT COUNT(*) as c FROM users WHERE register_ip = ? AND created_at >= ?'
    ).get(ip, nowSec - 24 * 3600).c;
    if (count >= guard.ipLimit) {
      return { ok: false, error: '当前网络环境下注册次数已达上限，请更换网络或稍后再试' };
    }
  }

  // 3. 同设备指纹注册数限制
  if (guard.deviceLimit > 0 && deviceFingerprint) {
    const count = db.prepare(
      'SELECT COUNT(*) as c FROM users WHERE device_fingerprint = ?'
    ).get(deviceFingerprint).c;
    if (count >= guard.deviceLimit) {
      return { ok: false, error: '该设备注册次数已达上限，请更换设备或联系客服' };
    }
  }

  return { ok: true };
}

// 登录成功后的统一响应：签发 access + refresh token
async function issueTokens(user) {
  const accessToken = await signAccessToken(user);
  const refreshToken = await signRefreshToken(user);
  return { accessToken, refreshToken };
}

router.post('/register', registerLimiter, async (req, res) => {
  const { email, password, name, device_fingerprint, agree_terms } = req.body || {};
  if (getSetting('registration_open', 'true') !== 'true') {
    return res.status(403).json({ error: '管理员已关闭注册' });
  }
  if (!email || !password || !name) return res.status(400).json({ error: '请填写邮箱、密码和昵称' });
  // 用户需知：注册前必须勾选同意（规避学术滥用法律风险）
  if (!agree_terms) return res.status(400).json({ error: '请先阅读并同意用户需知' });
  const pwdErr = validatePasswordStrength(password);
  if (pwdErr) return res.status(400).json({ error: pwdErr });

  // 邮箱归一化：转小写 + 去空格，并校验格式（防大小写/空格绕过唯一约束）
  const normalizedEmail = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: '邮箱格式不正确' });
  }

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (exists) return res.status(409).json({ error: '该邮箱已注册' });

  // 注册风控：一次性邮箱 / 同 IP 24h 注册数 / 同设备指纹注册数
  const ip = getClientIp(req);
  const deviceFingerprint = sanitizeDeviceFingerprint(device_fingerprint);
  const guard = checkSignupGuard({ email: normalizedEmail, ip, deviceFingerprint });
  if (!guard.ok) return res.status(429).json({ error: guard.error });

  const hash = await hashPassword(password);
  const info = db.prepare(
    'INSERT INTO users (email, password_hash, name, register_ip, device_fingerprint) VALUES (?, ?, ?, ?, ?)'
  ).run(normalizedEmail, hash, name, ip || null, deviceFingerprint);

  // 注册赠送积分
  const { points } = getSignupPointsConfig();
  if (points > 0) {
    grantPoints(info.lastInsertRowid, points, 'signup_bonus', '新用户注册赠送积分');
    logger.info('auth', `新用户注册赠送 ${points} 积分: ${normalizedEmail} (ip=${ip || 'unknown'}, device=${deviceFingerprint || 'unknown'})`);
  }

  const user = safeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid));
  const { accessToken, refreshToken } = await issueTokens(user);
  setRefreshCookie(res, refreshToken);
  res.json({ token: accessToken, accessToken, user });
});

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: '请填写邮箱和密码' });
  const normalizedEmail = String(email).trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  // 统一错误信息，防邮箱枚举
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: '邮箱或密码错误' });
  }
  if (user.status === 'banned') return res.status(403).json({ error: '账号已被禁用' });
  const { accessToken, refreshToken } = await issueTokens(user);
  setRefreshCookie(res, refreshToken);
  res.json({ token: accessToken, accessToken, user: safeUser(user) });
});

// 刷新 access token：用 refresh token 换新 access + 新 refresh（轮换）
router.post('/refresh', async (req, res) => {
  const refreshToken = getRefreshTokenFromCookie(req) || (req.body && req.body.refreshToken);
  const user = verifyRefreshToken(refreshToken);
  if (!user) {
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'refresh token 无效或已过期' });
  }
  // 轮换：旧 refresh token 吊销，发新的（防重放）
  const newRefreshToken = await rotateRefreshToken(refreshToken, user);
  const accessToken = await signAccessToken(user);
  setRefreshCookie(res, newRefreshToken);
  res.json({ accessToken });
});

// 登出：仅吊销当前 refresh token（不影响其他设备）
// access token 短效（15 分钟），自然过期即可；不再全局 token_version++（那会误伤其他已登录设备）
router.post('/logout', authRequired, (req, res) => {
  const refreshToken = getRefreshTokenFromCookie(req) || (req.body && req.body.refreshToken);
  if (refreshToken) {
    // 仅吊销当前设备的 refresh token，不吊销其他设备
    revokeRefreshToken(refreshToken);
  }
  clearRefreshCookie(res);
  res.json({ ok: true });
});

// 忘记密码：生成重置 token 并发送邮件
// 安全：无论邮箱是否存在都返回相同响应，防邮箱枚举
router.post('/forgot-password', forgotLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: '请填写邮箱' });

  // 邮箱归一化：与注册/登录保持一致（转小写 + 去空格）
  const normalizedEmail = String(email).trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  if (user) {
    // 生成重置 token
    const resetToken = generatePasswordResetToken(user.id);
    const { subject, text, html } = buildPasswordResetEmail(normalizedEmail, resetToken);
    const mailResult = await sendMail({ to: normalizedEmail, subject, text, html });
    // mock 模式下返回 preview 路径，便于演示查看
    if (mailResult.mock) {
      logger.info('auth', `密码重置邮件已发送（mock），重置链接预览：${mailResult.preview}`);
    }
  }
  // 统一响应，防邮箱枚举
  res.json({ ok: true, message: '若该邮箱已注册，重置链接已发送至邮箱' });
});

// 重置密码：校验 token + 新密码
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: '请提供重置令牌和新密码' });
  const pwdErr = validatePasswordStrength(password);
  if (pwdErr) return res.status(400).json({ error: pwdErr });

  const userId = consumePasswordResetToken(token);
  if (!userId) return res.status(400).json({ error: '重置令牌无效或已过期' });

  const hash = await hashPassword(password);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
  // token_version++ 使所有已签发的 access token 失效
  incrementTokenVersion(userId);
  // 吊销所有 refresh token
  revokeAllRefreshTokens(userId);
  res.json({ ok: true, message: '密码重置成功，请重新登录' });
});

router.get('/me', authRequired, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json({ user: safeUser(user) });
});

export default router;

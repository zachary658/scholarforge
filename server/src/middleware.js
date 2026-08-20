import { verifyToken } from './auth.js';
import db from './db.js';

function getUserRecord(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登录' });
  const payload = await verifyToken(token);
  if (!payload) return res.status(401).json({ error: '登录已过期，请重新登录' });
  const user = getUserRecord(payload.id);
  if (!user) return res.status(401).json({ error: '用户不存在' });
  if (user.status === 'banned') return res.status(403).json({ error: '账号已被禁用，请联系管理员' });
  // 软删除用户与禁用同等对待：立即拒绝访问（此前只拦 banned，被删用户 token 有效期内仍可访问）
  if (user.status === 'deleted') return res.status(401).json({ error: '账号不存在' });
  // token_version 校验：修改密码/登出后 token_version++，payload 中的旧 ver 不匹配则失效
  const payloadVer = payload.ver || 0;
  const dbVer = user.token_version || 0;
  if (payloadVer !== dbVer) {
    return res.status(401).json({ error: '登录状态已失效，请重新登录' });
  }
  // 从数据库获取最新的管理员/客服状态，而非 token payload
  req.user = { ...payload, is_admin: !!user.is_admin, is_support: !!user.is_support };
  next();
}

export function adminRequired(req, res, next) {
  // authRequired 是 async：显式接住 rejection（DB 异常等）交给全局错误处理器，避免 unhandledRejection + 请求挂起
  authRequired(req, res, () => {
    if (!req.user.is_admin) return res.status(403).json({ error: '需要管理员权限' });
    next();
  }).catch((err) => next(err));
}

// 客服及以上权限：admin 或 support 均可访问
export function supportRequired(req, res, next) {
  authRequired(req, res, () => {
    if (!req.user.is_admin && !req.user.is_support) return res.status(403).json({ error: '需要客服或管理员权限' });
    next();
  }).catch((err) => next(err));
}

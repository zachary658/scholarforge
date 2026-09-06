// 登录账号维度防爆破锁（与 IP 限流互补）
// 存储策略（与 rateLimit.js / redisClient.js 一致）：
//   - 配置 REDIS_URL（生产/多实例部署）→ Redis 原子计数 + TTL，锁定状态跨实例共享，
//     不可被水平扩容绕过；键为 acctlock:fail:<sha256(归一化邮箱)>，不在 Redis 落明文邮箱。
//   - 未配置 / Redis 不可用 → 回退进程内存 Map（仅适合单实例/开发环境）。
// 语义：失败计数键带 TTL（窗口 = 锁定时长 15 分钟）；达到阈值（5 次）后，
//   剩余 TTL 即剩余锁定期；登录成功立即删除计数。对不存在与存在的账号一视同仁，
//   避免借锁定行为差异枚举注册邮箱。
import crypto from 'node:crypto';
import logger from '../logger.js';
import { getSharedRedisClient } from './redisClient.js';

export const ACCOUNT_LOCK_THRESHOLD = 5;      // 连续失败阈值
export const ACCOUNT_LOCK_SECONDS = 15 * 60;  // 计数窗口 = 锁定时长：15 分钟
const ACCOUNT_FAIL_MAP_LIMIT = 10000;         // 内存回退的记录条数上限（防内存被撑爆）

// 内存回退存储：归一化账号 -> { fails, expireAt }（过期即清零，与 Redis TTL 语义对齐）
const memoryFails = new Map();

// 内存记录已过期时返回 null 并清除；否则返回记录
function getMemoryRecord(key) {
  const rec = memoryFails.get(key);
  if (!rec) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec >= rec.expireAt) {
    memoryFails.delete(key);
    return null;
  }
  return rec;
}

// 账号归一化（trim + 小写）：调用方（auth.js）已归一化，此处兜底，
// 避免未来调用方遗漏导致同账号多份计数（Redis 哈希键也不一致）。
function normalizeAccount(email) {
  return String(email || '').trim().toLowerCase();
}

function redisKey(normalizedEmail) {
  const hashed = crypto.createHash('sha256').update(normalizedEmail).digest('hex');
  return `acctlock:fail:${hashed}`;
}

// Lua：原子递增并在首次失败时设置 TTL，返回递增后的失败次数
const INCR_WITH_TTL_LUA = `
local fails = redis.call('INCR', KEYS[1])
if fails == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return fails
`;

// Lua：达到阈值时返回剩余 TTL（即剩余锁定期秒数），否则返回 0
const LOCK_REMAINING_LUA = `
local fails = redis.call('GET', KEYS[1])
if not fails or tonumber(fails) < tonumber(ARGV[1]) then
  return 0
end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  return 0
end
return ttl
`;

// 查询账号剩余锁定期（秒）；未锁定/锁已过期返回 0
export async function accountLockRemaining(email) {
  const normalizedEmail = normalizeAccount(email);
  const redis = await getSharedRedisClient().catch(() => null);
  if (redis) {
    try {
      const ttl = await redis.eval(LOCK_REMAINING_LUA, 1, redisKey(normalizedEmail), ACCOUNT_LOCK_THRESHOLD);
      return Math.max(0, Number(ttl) || 0);
    } catch (err) {
      logger.error('account-lock', `Redis 查询锁定状态失败，降级进程内存: ${err.message}`);
      // 落入下方内存回退
    }
  }
  const rec = getMemoryRecord(normalizedEmail);
  if (!rec || rec.fails < ACCOUNT_LOCK_THRESHOLD) return 0;
  return rec.expireAt - Math.floor(Date.now() / 1000);
}

// 记录一次登录失败（达到阈值即视为锁定，剩余 TTL 为锁定期）
export async function recordAccountFailure(email) {
  const normalizedEmail = normalizeAccount(email);
  const redis = await getSharedRedisClient().catch(() => null);
  if (redis) {
    try {
      await redis.eval(INCR_WITH_TTL_LUA, 1, redisKey(normalizedEmail), ACCOUNT_LOCK_SECONDS);
      return;
    } catch (err) {
      logger.error('account-lock', `Redis 记录失败计数失败，降级进程内存: ${err.message}`);
      // 落入下方内存回退
    }
  }
  // 内存防护：超过条数上限时先清理已过期的旧记录
  if (memoryFails.size > ACCOUNT_FAIL_MAP_LIMIT) {
    const nowSec = Math.floor(Date.now() / 1000);
    for (const [k, rec] of memoryFails) {
      if (nowSec >= rec.expireAt) memoryFails.delete(k);
    }
  }
  const rec = getMemoryRecord(normalizedEmail) || {
    fails: 0,
    expireAt: Math.floor(Date.now() / 1000) + ACCOUNT_LOCK_SECONDS,
  };
  rec.fails += 1;
  memoryFails.set(normalizedEmail, rec);
}

// 登录成功：删除失败计数并解除锁定（Redis 与内存同时清理）
export async function clearAccountFailures(email) {
  const normalizedEmail = normalizeAccount(email);
  const redis = await getSharedRedisClient().catch(() => null);
  if (redis) {
    try {
      await redis.del(redisKey(normalizedEmail));
    } catch (err) {
      logger.error('account-lock', `Redis 清除失败计数失败: ${err.message}`);
    }
  }
  memoryFails.delete(normalizedEmail);
}

// 测试辅助：清空内存回退记录
export function resetAccountLockMemory() {
  memoryFails.clear();
}

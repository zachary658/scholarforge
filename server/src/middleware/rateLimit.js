// 统一限流中间件
// 存储策略：
//   - 配置 REDIS_URL（生产/多实例部署）→ 通过 rate-limit-redis + ioredis 使用集中式 Redis 存储，
//     多实例共享计数，限流不可被水平扩容绕过。
//   - 未配置 REDIS_URL → 回退进程内存（express-rate-limit 内置 MemoryStore），仅适合单实例/开发环境。
//   - 生产环境未配置 REDIS_URL 时打印醒目警告（不阻断启动，保持与既有部署的兼容）。
// Redis 初始化为惰性单例：首次创建 limiter 时加载，连接失败时降级内存存储并记录错误。
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import logger from '../logger.js';

let redisStorePromise = null;
let redisClient = null;

// 获取共享的 Redis Store（懒加载单例）。
// 未配置 REDIS_URL 返回 null；加载或连接失败时记录错误并返回 null（降级内存存储）。
async function getRedisStore() {
  if (!process.env.REDIS_URL) return null;
  if (!redisStorePromise) {
    redisStorePromise = (async () => {
      try {
        const { default: Redis } = await import('ioredis');
        const { RedisStore } = await import('rate-limit-redis');
        redisClient = new Redis(process.env.REDIS_URL, {
          maxRetriesPerRequest: 2,
          // 限流计数丢失可容忍：连接彻底失败时让 store 抛错由 limiter 兜底，不无限重试阻塞请求
          enableOfflineQueue: false,
          lazyConnect: false,
        });
        redisClient.on('error', (err) => logger.error('rate-limit', `Redis 连接异常: ${err.message}`));
        logger.info('rate-limit', '限流存储已切换到 Redis（REDIS_URL 已配置）');
        return new RedisStore({
          // rate-limit-redis v4：统一通过 sendCommand 透传命令，兼容 ioredis
          sendCommand: (...args) => redisClient.call(...args),
        });
      } catch (err) {
        logger.error('rate-limit', `Redis 限流存储初始化失败，降级为进程内存存储: ${err.message}`);
        return null;
      }
    })();
  }
  return redisStorePromise;
}

// 关闭 Redis 连接（优雅停机 / 测试清理用）：断开后 limiter 自动降级内存存储
export async function closeRateLimitStore() {
  if (redisClient) {
    try { redisClient.disconnect(); } catch { /* ignore */ }
    redisClient = null;
    redisStorePromise = null;
  }
}

if (process.env.NODE_ENV === 'production' && !process.env.REDIS_URL) {
  logger.warn(
    'rate-limit',
    '生产环境未配置 REDIS_URL，限流使用进程内存存储：多实例部署时限流计数不共享，可能被水平扩容绕过。'
  );
}

// 限流工厂：支持按用户 / IP / 二者组合作为限流维度
// 注意：makeLimiter 返回 async 包装（Redis 存储需异步初始化），用法与原生 middleware 一致。
export function makeLimiter({
  windowMs = 60 * 1000,
  max = 60,
  keyType = 'user-ip', // 'user' | 'ip' | 'user-ip'
  message = '操作过于频繁，请稍后再试',
  skip,
} = {}) {
  const keyGenerator = (req) => {
    const uid = req.user && req.user.id ? `u${req.user.id}` : 'anon';
    if (keyType === 'user') return uid;
    // ipKeyGenerator 将 IPv6 归一到 /56 子网，避免攻击者通过轮换 IPv6 地址绕过限流；
    // 同时消除 express-rate-limit 的 IPv6 keyGenerator 校验告警。
    const ip = ipKeyGenerator(req.ip || req.socket?.remoteAddress || '');
    if (keyType === 'ip') return `ip:${ip}`;
    return `${uid}:${ip}`;
  };

  // 预创建内存版本 limiter：Redis 不可用或未配置时直接使用
  const memoryLimiter = rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
    skip,
    keyGenerator,
  });

  let storeBound = null; // 绑定 Redis store 的 limiter（首次请求时初始化）
  let redisUnavailable = false;

  return async function rateLimiter(req, res, next) {
    try {
      if (!storeBound && !redisUnavailable) {
        const store = await getRedisStore();
        if (store) {
          storeBound = rateLimit({
            windowMs,
            max,
            store,
            standardHeaders: true,
            legacyHeaders: false,
            message: { error: message },
            skip,
            keyGenerator,
          });
        } else {
          redisUnavailable = true; // 未配置或初始化失败，后续请求直接走内存版本
        }
      }
      return (storeBound || memoryLimiter)(req, res, next);
    } catch (err) {
      // Redis 请求异常（连接中断等）：降级内存 limiter，限流可用性优先
      logger.error('rate-limit', `Redis 限流异常，本次降级内存存储: ${err.message}`);
      return memoryLimiter(req, res, next);
    }
  };
}

// AI 工具统一限流：每用户每分钟最多 60 次（覆盖全部 /tools 写操作，防大模型成本被批量刷）
export const aiToolLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 60,
  keyType: 'user',
  message: 'AI 调用过于频繁，请稍后再试',
});

// 支付 / 订单动作限流：每用户每分钟最多 30 次（防订单与支付接口被刷）
export const paymentLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 30,
  keyType: 'user',
  message: '支付请求过于频繁，请稍后再试',
});

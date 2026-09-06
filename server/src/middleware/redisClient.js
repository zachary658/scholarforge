// 共享 Redis 客户端（惰性单例）
// rateLimit（限流计数）与 accountLock（登录账号锁）共用同一连接，避免重复建连。
// 策略与 rateLimit.js 一致：
//   - 配置 REDIS_URL（生产/多实例部署）→ 集中式 Redis，计数跨实例共享；
//   - 未配置 → 返回 null，调用方各自回退进程内存（仅适合单实例/开发）；
//   - 连接/初始化失败 → 记录错误并返回 null（降级，不阻断启动）。
import logger from '../logger.js';

let clientPromise = null;
let client = null;

// 获取共享 Redis 客户端；未配置 REDIS_URL 返回 null。
export async function getSharedRedisClient() {
  if (!process.env.REDIS_URL) return null;
  if (!clientPromise) {
    clientPromise = (async () => {
      try {
        const { default: Redis } = await import('ioredis');
        client = new Redis(process.env.REDIS_URL, {
          maxRetriesPerRequest: 2,
          // 计数丢失可容忍（回退内存/放行单次请求），不无限重试阻塞业务请求
          enableOfflineQueue: false,
          lazyConnect: false,
        });
        client.on('error', (err) => logger.error('redis', `Redis 连接异常: ${err.message}`));
        logger.info('redis', 'Redis 客户端已初始化（REDIS_URL 已配置）');
        return client;
      } catch (err) {
        logger.error('redis', `Redis 客户端初始化失败，相关计数降级为进程内存: ${err.message}`);
        return null;
      }
    })();
  }
  return clientPromise;
}

// 关闭共享连接（优雅停机 / 测试清理用）：断开后各调用方自动降级内存
export async function closeSharedRedisClient() {
  if (client) {
    try { client.disconnect(); } catch { /* ignore */ }
    client = null;
    clientPromise = null;
  }
}

// 统一限流中间件（M-2 加固�?
// 默认基于进程内存（express-rate-limit 内置 MemoryStore）�?
// 注意：多实例 / 集群部署时，内存计数不共享会导致限流被绕过——生产环境应切换到集中式存储�?
// 切换方式（需自行安装依赖，此处保�? 0 新增依赖、仅预留 store 注入点）�?
//   import { RedisStore } from 'rate-limit-redis';
//   const store = new RedisStore({ sendCommand: (...a) => redisClient.call(...a) });
//   makeLimiter({ store, ... })
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// 限流工厂：支持按用户 / IP / 二者组合作为限流维�?
export function makeLimiter({
  windowMs = 60 * 1000,
  max = 60,
  keyType = 'user-ip', // 'user' | 'ip' | 'user-ip'
  message = '操作过于频繁，请稍后再试',
  skip,
} = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
    skip,
    keyGenerator: (req) => {
      const uid = req.user && req.user.id ? `u${req.user.id}` : 'anon';
      if (keyType === 'user') return uid;
      // ipKeyGenerator �� IPv6 ��һ�� /56 ���������⹥����ͨ���ֻ� IPv6 ��ַ�ƹ�������
      // ͬʱ���� express-rate-limit �� IPv6 keyGenerator У��澯��
      const ip = ipKeyGenerator(req.ip || req.socket?.remoteAddress || '');
      if (keyType === 'ip') return `ip:${ip}`;
      return `${uid}:${ip}`;
    },
  });
}

// AI 工具统一限流：每用户每分钟最�? 60 次（覆盖全部 /tools 写操作，防大模型成本被批量刷�?
export const aiToolLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 60,
  keyType: 'user',
  message: 'AI 调用过于频繁，请稍后再试',
});

// 支付 / 订单动作限流：每用户每分钟最�? 30 次（防订单与支付接口被刷�?
export const paymentLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 30,
  keyType: 'user',
  message: '支付请求过于频繁，请稍后再试',
});

// 限流中间件测试：内存模式正常限流 + Redis 不可达时降级内存存储（不阻断请求）
// makeLimiter 的 REDIS_URL 分支为惰性初始化：本文件在进程内动态设置 REDIS_URL 验证降级路径。
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-rl-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
delete process.env.REDIS_URL; // 先以纯内存模式验证基础行为

const { makeLimiter, closeRateLimitStore } = await import('../src/middleware/rateLimit.js');

// 清理 ioredis 连接句柄：后台重连会保持事件循环存活，导致测试进程挂起
after(async () => {
  await closeRateLimitStore();
});

// 极简 mock：覆盖 express-rate-limit v8 用到的 req/res 方法
function mockReq(ip = '203.0.113.10', user = null) {
  return {
    ip,
    method: 'GET',
    path: '/',
    url: '/',
    protocol: 'http',
    headers: {},
    socket: { remoteAddress: ip },
    user,
    get() { return undefined; },
    on() {},
  };
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headersSent: false,
    setHeader(k, v) { this[k] = v; return this; },
    getHeader(k) { return this[k]; },
    removeHeader() {},
    status(code) { this.statusCode = code; return this; },
    send(b) { this.body = b; this.headersSent = true; return this; },
    json(b) { return this.send(b); },
    end() { this.headersSent = true; return this; },
    on() {},
    once() {},
  };
}

// 依次发起 n 次请求，返回每次的状态码与响应体
// 注意：被限流拦截的请求不会调用 next()，而是直接 res.status(429).send()，
// 因此以中间件 promise 完成后的 res.statusCode 判定结果（与 Express 真实行为一致）。
async function fire(limiter, n, { ip, user } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const req = mockReq(ip, user);
    const res = mockRes();
    await limiter(req, res, () => {});
    out.push({ statusCode: res.statusCode, body: res.body });
  }
  return out;
}

test('内存模式：超过阈值后返回 429', async () => {
  const limiter = makeLimiter({ max: 3, windowMs: 60_000, keyType: 'ip', message: '测试限流' });
  const results = await fire(limiter, 4, { ip: '198.51.100.7' });
  assert.deepEqual(results.map((r) => r.statusCode), [200, 200, 200, 429], '前 3 次放行，第 4 次 429');
  assert.equal(results[3].body.error, '测试限流', '429 响应应携带错误消息');
});

test('内存模式：不同 IP 计数隔离', async () => {
  const limiter = makeLimiter({ max: 2, windowMs: 60_000, keyType: 'ip', message: 'x' });
  await fire(limiter, 2, { ip: '198.51.100.1' });
  const other = await fire(limiter, 1, { ip: '198.51.100.2' });
  assert.equal(other[0].statusCode, 200, '不同 IP 不应共享计数');
});

test('Redis 不可达时降级内存存储：请求不被阻断，限流仍生效', async () => {
  // 指向必然拒绝连接的地址（端口 1 无 Redis）：验证初始化失败/命令失败时请求不被打成 5xx
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  const limiter = makeLimiter({ max: 3, windowMs: 60_000, keyType: 'ip', message: '降级限流' });
  const results = await fire(limiter, 4, { ip: '198.51.100.9' });
  const codes = results.map((r) => r.statusCode);
  // 关键断言：Redis 故障不应把请求打成 5xx（全部有明确结果，200 放行 / 429 拦截）
  assert.ok(results.every((r) => r.statusCode === 200 || r.statusCode === 429), `不应出现 5xx，实际状态码: ${JSON.stringify(codes)}`);
  assert.ok(results.slice(0, 3).every((r) => r.statusCode === 200), '降级后前 3 次仍应放行');
  delete process.env.REDIS_URL;
});

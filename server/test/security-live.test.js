// 实时安全/功能集成测试：真实启动 server 子进程，验证
//   1) 认证闭环与 401 拒绝（无 token / 非法 token）
//   2) 订单列表鉴权可访问、不存在订单返回 404（功能性）
//   3) 注册限流：单 IP 越过阈值后返回 429（防批量注册 / 暴力枚举）
// 无需浏览器或真实 AI Key（development 模式启用 mock 支付即可启动）。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 4611;
const BASE = `http://127.0.0.1:${PORT}`;
const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(mkdtempSync(join(tmpdir(), 'sf-live-')), 'test.db');

let child = null;

function startServer() {
  return new Promise((resolve, reject) => {
    child = spawn('node', ['src/index.js'], {
      cwd: serverDir,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        PORT: String(PORT),
        DB_PATH,
        JWT_SECRET: 'live-test-secret-please-change-32chars-minimum',
        LOG_TO_FILE: 'false',
        LOG_LEVEL: 'error',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.on('data', () => {});
    const to = setTimeout(() => reject(new Error('server start timeout (25s)')), 25000);
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`${BASE}/api/health`);
        if (r.ok) {
          clearTimeout(to);
          clearInterval(poll);
          resolve();
        }
      } catch { /* not ready */ }
    }, 500);
    child.on('exit', (code) => {
      clearTimeout(to);
      clearInterval(poll);
      reject(new Error(`server exited early (code=${code})`));
    });
  });
}

after(() => { if (child) { try { child.kill('SIGKILL'); } catch { /* ignore */ } } });

test('LIVE: 认证闭环 + 订单鉴权 + 注册限流 429', async () => {
  await startServer();

  // 1) 健康检查
  const health = await fetch(`${BASE}/api/health`);
  assert.equal(health.status, 200);

  // 2) 注册 + 登录拿到 token
  const email = `live_${Date.now()}@example.com`;
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'LivePass123', name: 'Live', agree_terms: true }),
  });
  assert.equal(reg.status, 200);
  const { accessToken } = await reg.json();
  assert.ok(accessToken);

  // 3) 合法 token 访问受保护接口
  const me = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  assert.equal(me.status, 200);

  // 4) 无 token / 非法 token 必须 401
  const noTok = await fetch(`${BASE}/api/auth/me`);
  assert.equal(noTok.status, 401, '缺失 token 应 401');
  const badTok = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: 'Bearer garbage.token.here' } });
  assert.equal(badTok.status, 401, '非法 token 应 401');

  // 5) 订单列表鉴权可访问；不存在订单返回 404（功能性校验）
  const list = await fetch(`${BASE}/api/orders`, { headers: { Authorization: `Bearer ${accessToken}` } });
  assert.equal(list.status, 200);
  const listJson = await list.json();
  assert.ok(Array.isArray(listJson.orders));
  const missing = await fetch(`${BASE}/api/orders/NO_SUCH_ORDER`, { headers: { Authorization: `Bearer ${accessToken}` } });
  assert.equal(missing.status, 404, '不存在订单应 404');

  // 6) 注册限流：单 IP 15 分钟内最多 5 次（registerLimiter）。
  //    已用掉 1 次（上面的注册），再快速注册 7 个不同邮箱，越过阈值后应出现 429。
  let saw429 = false;
  for (let i = 0; i < 7; i++) {
    const r = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `rl_${Date.now()}_${i}@example.com`,
        password: 'LivePass123',
        name: 'RL',
        agree_terms: true,
      }),
    });
    if (r.status === 429) saw429 = true;
  }
  assert.ok(saw429, '注册越过限流阈值后应返回 429');
});

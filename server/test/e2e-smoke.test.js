// E2E 冒烟测试：真实启动 server 子进程，验证「启动 -> 健康检查 -> 注册 -> 登录 -> 鉴权 -> 非法 token 拒绝」
// 纳入 `node --test`，作为 CI 门禁的一部分（无需浏览器 / 真实 AI Key）。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 4599;
const BASE = `http://127.0.0.1:${PORT}`;
const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..'); // server/test -> server
const DB_PATH = join(mkdtempSync(join(tmpdir(), 'sf-e2e-')), 'test.db');

let child = null;

function startServer() {
  return new Promise((resolve, reject) => {
    // 用 process.execPath 而非裸 'node'：better-sqlite3 是针对某个 Node ABI 编译的，
    // 若 PATH 里的 node 与测试运行器不是同一版本（例如本地装了 Node 24 而依赖编译于 Node 22），
    // 子进程会以 ERR_DLOPEN_FAILED 直接退出，导致 E2E 误报失败。
    child = spawn(process.execPath, ['src/index.js'], {
      cwd: serverDir,
      env: {
        ...process.env,
        NODE_ENV: 'development', // 允许 mock 支付，免去生产支付配置即可启动
        PORT: String(PORT),
        DB_PATH,
        JWT_SECRET: 'e2e-test-secret-please-change-32chars-minimum',
        LOG_TO_FILE: 'false',
        LOG_LEVEL: 'error',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.on('data', () => {}); // 静默，避免噪声；失败由断言体现

    const to = setTimeout(() => reject(new Error('server start timeout (25s)')), 25000);
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`${BASE}/api/health`);
        if (r.ok) {
          clearTimeout(to);
          clearInterval(poll);
          resolve();
        }
      } catch {
        /* not ready yet */
      }
    }, 500);

    child.on('exit', (code) => {
      clearTimeout(to);
      clearInterval(poll);
      reject(new Error(`server exited early (code=${code})`));
    });
  });
}

// 无论如何都确保子进程被回收，避免测试进程挂起
after(async () => {
  if (child) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
});

test('E2E: 启动 + 健康检查 + 注册/登录/鉴权闭环', async () => {
  await startServer();

  // 1) 健康检查
  const health = await fetch(`${BASE}/api/health`);
  assert.equal(health.status, 200, 'health should return 200');
  const hj = await health.json();
  assert.equal(hj.ok, true);

  // 2) 注册
  const email = `e2e_${Date.now()}@example.com`;
  const password = 'e2ePass123';
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name: 'E2E User', agree_terms: true }),
  });
  assert.equal(reg.status, 200, 'register should return 200');
  const regJson = await reg.json();
  assert.ok(regJson.accessToken, 'register should return accessToken');

  // 3) 用 accessToken 访问受保护接口
  const me = await fetch(`${BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${regJson.accessToken}` },
  });
  assert.equal(me.status, 200, '/me with valid token should return 200');
  const meJson = await me.json();
  assert.equal(meJson.user.email, email);

  // 4) 登录
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200, 'login should return 200');
  const loginJson = await login.json();
  assert.ok(loginJson.accessToken, 'login should return accessToken');

  // 5) 非法 token 必须被拒绝
  const bad = await fetch(`${BASE}/api/auth/me`, {
    headers: { Authorization: 'Bearer not-a-valid-token' },
  });
  assert.equal(bad.status, 401, 'invalid token should be rejected with 401');

  // 6) 缺失 token 必须被拒绝
  const noTok = await fetch(`${BASE}/api/auth/me`);
  assert.equal(noTok.status, 401, 'missing token should be rejected with 401');
});

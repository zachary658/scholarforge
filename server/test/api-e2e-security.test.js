// API 安全与业务闭环 E2E 测试：真实启动 server 子进程（development + mock 支付）
// 覆盖：
//   1) 注册：成功 / 弱密码 400 / 缺字段 400 / 重复邮箱 409
//   2) 登录：成功 / 错误密码 401 / 未带 token 访问受保护接口 401
//   3) 权限（IDOR/越权）：普通用户访问管理端点 403；跨用户文档/订单/支付状态/材料 403/404
//   4) 项目证据：文献/图表关联项目、按项目筛选、跨用户项目拒绝
//   5) 订单 + 支付闭环：创建功能订单 → mock 支付 → 重复支付幂等 → 并发支付仅一次入账
//   6) 支付回调：伪造支付宝回调 fail / 微信回调无验签头 401
//   7) 文档上传下载：材料上传（txt 成功 / 伪造 pdf 400）、列表隔离、删除越权 404
// 注意：注册风控默认同 IP 24h 最多 3 个账号，本文件只成功注册 2 个用户。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 4623;
const BASE = `http://127.0.0.1:${PORT}`;
const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(mkdtempSync(join(tmpdir(), 'sf-api-')), 'test.db');

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
        NODE_ENV: 'development',
        PORT: String(PORT),
        DB_PATH,
        JWT_SECRET: 'api-e2e-test-secret-please-change-32chars',
        LOG_TO_FILE: 'false',
        LOG_LEVEL: 'error',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.on('data', () => {});
    child.stdout.on('data', () => {});
    const to = setTimeout(() => reject(new Error('server start timeout (25s)')), 25000);
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`${BASE}/api/health`);
        if (r.ok) {
          clearTimeout(to);
          clearInterval(poll);
          resolve();
        }
      } catch { /* not ready yet */ }
    }, 500);
    child.on('exit', (code) => {
      clearTimeout(to);
      clearInterval(poll);
      reject(new Error(`server exited early (code=${code})`));
    });
  });
}

after(() => { if (child) { try { child.kill('SIGKILL'); } catch { /* ignore */ } } });

function api(path, { method = 'GET', token, body, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  return fetch(`${BASE}${path}`, {
    method,
    headers,
    body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function registerUser(email) {
  const r = await api('/api/auth/register', {
    method: 'POST',
    body: { email, password: 'Str0ngPass123', name: 'API 测试用户', agree_terms: true },
  });
  assert.equal(r.status, 200, `注册应成功: ${email}`);
  const j = await r.json();
  assert.ok(j.accessToken, '注册应返回 accessToken');
  return j.accessToken;
}

test('API E2E: 注册/登录/权限/订单支付/回调/上传下载 全链路', async () => {
  await startServer();
  const ts = Date.now();
  const emailA = `apia_${ts}@example.com`;
  const emailB = `apib_${ts}@example.com`;

  // ---------- 1) 注册校验 ----------
  let r = await api('/api/auth/register', {
    method: 'POST',
    body: { email: `weak_${ts}@example.com`, password: 'short', name: '弱密码', agree_terms: true },
  });
  assert.equal(r.status, 400, '弱密码应 400');

  r = await api('/api/auth/register', {
    method: 'POST',
    body: { email: `miss_${ts}@example.com`, name: '缺字段' },
  });
  assert.equal(r.status, 400, '缺少密码应 400');

  const tokenA = await registerUser(emailA);
  const tokenB = await registerUser(emailB);

  r = await api('/api/auth/register', {
    method: 'POST',
    body: { email: emailA, password: 'Str0ngPass123', name: '重复', agree_terms: true },
  });
  assert.equal(r.status, 409, '重复邮箱应 409');

  // ---------- 2) 登录 ----------
  r = await api('/api/auth/login', { method: 'POST', body: { email: emailA, password: 'wrongPass123' } });
  assert.equal(r.status, 401, '错误密码应 401');

  r = await api('/api/auth/login', { method: 'POST', body: { email: emailA, password: 'Str0ngPass123' } });
  assert.equal(r.status, 200, '正确密码登录应 200');

  r = await api('/api/documents');
  assert.equal(r.status, 401, '无 token 访问受保护接口应 401');

  // ---------- 3) 权限：普通用户不可访问管理/客服端点 ----------
  r = await api('/api/admin/overview', { token: tokenA });
  assert.equal(r.status, 403, '普通用户访问管理端点应 403');
  r = await api('/api/support/overview', { token: tokenA });
  assert.equal(r.status, 403, '普通用户访问客服端点应 403');

  // ---------- 4) 文档 CRUD + 越权 ----------
  r = await api('/api/documents', { method: 'POST', token: tokenA, body: { title: 'A 的文档', tool_type: 'draft', content: '私有内容' } });
  assert.equal(r.status, 200, 'A 创建文档应 200');
  const docA = (await r.json()).document;

  r = await api('/api/documents', { token: tokenB });
  const docsB = (await r.json()).documents;
  assert.ok(!docsB.some((d) => d.id === docA.id), 'B 的文档列表不应包含 A 的文档');

  r = await api(`/api/documents/${docA.id}`, { method: 'PUT', token: tokenB, body: { title: '篡改' } });
  assert.ok([403, 404].includes(r.status), 'B 修改 A 的文档应被拒绝');
  r = await api(`/api/documents/${docA.id}`, { method: 'DELETE', token: tokenB });
  assert.ok([403, 404].includes(r.status), 'B 删除 A 的文档应被拒绝');

  // ---------- 5) 项目证据库：文献/图表归属、筛选与越权 ----------
  r = await api('/api/projects', {
    method: 'POST', token: tokenA, body: { title: 'A 的证据论文', field: '计算机科学' },
  });
  assert.equal(r.status, 200, 'A 创建论文项目应 200');
  const projectA = (await r.json()).project;

  r = await api('/api/projects', {
    method: 'POST', token: tokenB, body: { title: 'B 的私有论文', field: '管理学' },
  });
  const projectB = (await r.json()).project;

  r = await api('/api/references', {
    method: 'POST',
    token: tokenA,
    body: {
      title: '可溯源测试文献', authors: 'Test Author', year: '2026', projectId: projectA.id,
      abstract: '该研究使用 U-Net 完成医学影像分割，并报告可复核的实验结果。', doi: '10.1000/sf-test',
    },
  });
  assert.equal(r.status, 200, '项目文献收藏应 200');
  const projectRef = (await r.json()).reference;
  assert.equal(projectRef.project_id, projectA.id, '文献应绑定指定项目');

  r = await api(`/api/references?projectId=${projectA.id}`, { token: tokenA });
  assert.ok((await r.json()).references.some((ref) => ref.id === projectRef.id), '项目文献筛选应返回已收藏文献');
  r = await api(`/api/references?projectId=${projectA.id}`, { token: tokenB });
  assert.equal(r.status, 404, 'B 不可读取 A 的项目文献');
  r = await api('/api/references?projectId=abc', { token: tokenA });
  assert.equal(r.status, 404, '非法项目筛选参数不可退化为全部文献');

  r = await api(`/api/projects/${projectA.id}/evidence?q=医学影像`, { token: tokenA });
  assert.equal(r.status, 200, '项目所有者应可检索证据库');
  let evidenceBody = await r.json();
  assert.ok(evidenceBody.results.some((row) => row.source_id === String(projectRef.id)), '新收藏文献应自动写入证据库');
  assert.ok(evidenceBody.quality.traceability > 0, '含 DOI 的文献应计为可追溯证据');
  r = await api(`/api/projects/${projectA.id}/evidence?q=医学影像`, { token: tokenB });
  assert.equal(r.status, 404, 'B 不可检索 A 的项目证据');
  r = await api(`/api/projects/${projectA.id}/evidence/rebuild`, { method: 'POST', token: tokenB });
  assert.equal(r.status, 404, 'B 不可重建 A 的项目证据');
  r = await api(`/api/projects/${projectA.id}/evidence/rebuild`, { method: 'POST', token: tokenA });
  assert.equal(r.status, 200, '项目所有者应可重建历史证据索引');
  evidenceBody = await r.json();
  assert.ok(evidenceBody.quality.chunks > 0, '重建后证据不应丢失');

  r = await api('/api/charts/render', {
    method: 'POST',
    token: tokenA,
    body: {
      title: '项目证据测试图', chart_type: 'bar', x: 'group', y: 'value', projectId: projectA.id,
      rows: [{ group: 'A', value: 10 }, { group: 'B', value: 20 }],
    },
  });
  assert.equal(r.status, 200, '项目图表生成应 200');
  const projectChart = (await r.json()).chart;
  assert.equal(projectChart.project_id, projectA.id, '图表应绑定指定项目');
  r = await api(`/api/charts?projectId=${projectA.id}`, { token: tokenA });
  assert.ok((await r.json()).charts.some((chart) => chart.id === projectChart.id), '项目图表筛选应返回已生成图表');
  r = await api(projectChart.file_url, { token: tokenA });
  assert.equal(r.status, 200, '项目图表 PNG 应可下载');
  assert.ok((await r.arrayBuffer()).byteLength > 100, '项目图表 PNG 不应为空');
  r = await api('/api/charts/render', {
    method: 'POST',
    token: tokenA,
    body: { title: '越权图表', chart_type: 'bar', x: 'x', y: 'y', projectId: projectB.id, rows: [{ x: 'A', y: 1 }] },
  });
  assert.equal(r.status, 404, 'A 不可把图表绑定到 B 的项目');

  // ---------- 6) 订单 + 支付闭环（mock 通道） ----------
  r = await api('/api/orders', {
    method: 'POST',
    token: tokenA,
    body: { item_type: 'writing_paragraph', payment_method: 'mock' },
  });
  assert.equal(r.status, 200, '创建功能订单应 200');
  const { order: order1, payParams } = await r.json();
  assert.equal(order1.status, 'pending');
  assert.equal(payParams.channel, 'mock');
  assert.equal(order1.amount, 2, '订单金额应由服务端按定价计算（2 元）');

  // 越权：B 查/付 A 的订单
  r = await api(`/api/orders/${order1.order_no}`, { token: tokenB });
  assert.equal(r.status, 404, 'B 查看 A 的订单应 404（含归属过滤）');
  r = await api(`/api/payment/order/${order1.order_no}/status`, { token: tokenB });
  assert.equal(r.status, 403, 'B 查询 A 的支付状态应 403');
  r = await api(`/api/payment/mock/${order1.order_no}`, { method: 'POST', token: tokenB });
  assert.equal(r.status, 403, 'B 支付 A 的订单应 403');

  // A 正常 mock 支付
  r = await api(`/api/payment/mock/${order1.order_no}`, { method: 'POST', token: tokenA });
  assert.equal(r.status, 200, 'A mock 支付应 200');
  let paid = (await r.json()).order;
  assert.equal(paid.status, 'paid', '支付后订单应为 paid');
  assert.ok(paid.transaction_id, '应记录交易号');

  // 重复支付 → 幂等
  r = await api(`/api/payment/mock/${order1.order_no}`, { method: 'POST', token: tokenA });
  assert.equal(r.status, 200, '重复支付请求本身应成功返回');
  const dup = await r.json();
  assert.equal(dup.alreadyPaid, true, '重复支付应幂等返回 alreadyPaid');
  assert.equal(dup.order.status, 'paid');

  // 并发支付：同一订单两笔同时支付，恰好一次入账
  r = await api('/api/orders', {
    method: 'POST',
    token: tokenA,
    body: { item_type: 'writing_paragraph', payment_method: 'mock' },
  });
  const { order: order2 } = await r.json();
  const [c1, c2] = await Promise.all([
    api(`/api/payment/mock/${order2.order_no}`, { method: 'POST', token: tokenA }).then((x) => x.json()),
    api(`/api/payment/mock/${order2.order_no}`, { method: 'POST', token: tokenA }).then((x) => x.json()),
  ]);
  assert.equal(c1.order.status, 'paid');
  assert.equal(c2.order.status, 'paid');
  const firstPays = [c1, c2].filter((x) => !x.alreadyPaid);
  assert.equal(firstPays.length, 1, '并发支付应恰好一次首次入账，另一笔幂等');
  assert.equal(c1.order.transaction_id, c2.order.transaction_id, '并发支付只应绑定一笔交易号（不重复入账）');

  // 订单列表归属：B 看不到 A 的订单
  r = await api('/api/orders', { token: tokenB });
  const listB = (await r.json()).orders;
  assert.ok(!listB.some((o) => o.order_no === order1.order_no), 'B 的订单列表不应包含 A 的订单');

  // ---------- 7) 支付回调：伪造通知必须被拒 ----------
  r = await api('/api/payment/alipay/notify', {
    method: 'POST',
    body: { out_trade_no: order1.order_no, trade_status: 'TRADE_SUCCESS', total_amount: '0.01', sign: 'forged' },
  });
  assert.equal(await r.text(), 'fail', '伪造支付宝回调（验签失败）应返回 fail');

  r = await api('/api/payment/wechat/notify', {
    method: 'POST',
    body: { event_type: 'TRANSACTION.SUCCESS', resource: { ciphertext: 'x' } },
  });
  assert.equal(r.status, 401, '缺少微信验签头的回调应 401');
  assert.equal((await r.json()).code, 'FAIL');

  // ---------- 8) 材料上传 / 下载（列表）/ 删除 + 越权 ----------
  const fd = new FormData();
  fd.append('file', new Blob(['这是一份用于测试的材料文本内容。'], { type: 'text/plain' }), 'notes.txt');
  r = await fetch(`${BASE}/api/materials/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: fd,
  });
  assert.equal(r.status, 200, '上传 txt 材料应 200');
  const up = await r.json();
  assert.ok(up.id, '应返回材料 id');
  assert.ok(up.tokens > 0, '应估算 token 数');

  // 伪造扩展名：内容不是 PDF 却命名 .pdf → magic-byte 拦截
  const fd2 = new FormData();
  fd2.append('file', new Blob(['this is not a pdf at all'], { type: 'application/pdf' }), 'fake.pdf');
  r = await fetch(`${BASE}/api/materials/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: fd2,
  });
  assert.equal(r.status, 400, '伪造 pdf 扩展名应被 magic-byte 校验拒绝');

  // 列表隔离：B 的材料列表不含 A 的材料
  r = await api('/api/materials', { token: tokenB });
  const matsB = (await r.json()).materials;
  assert.ok(!matsB.some((m) => m.id === up.id), 'B 的材料列表不应包含 A 的材料');

  // B 删除 A 的材料 → 404（归属过滤）
  r = await api(`/api/materials/${up.id}`, { method: 'DELETE', token: tokenB });
  assert.equal(r.status, 404, 'B 删除 A 的材料应 404');

  // A 删除自己的材料 → 200
  r = await api(`/api/materials/${up.id}`, { method: 'DELETE', token: tokenA });
  assert.equal(r.status, 200, 'A 删除自己的材料应 200');
});

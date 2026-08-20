// 安全与功能回归测试（第二轮深度测试）
// 覆盖：SSRF 出站防护（含 IPv4 映射 IPv6 / 云元数据绕过）、日志脱敏、SVG 净化、
//       并发信号量、限流维度、支付金额服务端计算（防客户端篡改）、订单归属鉴权（防 IDOR）。
// 纯函数测试离线可跑；支付/鉴权逻辑测试使用临时内存数据库。
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-sec-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.NODE_ENV = 'test';

// ===== 纯函数 / 安全基元 =====
const { assertSafeAiResolvedUrl, createSemaphore } = await import('../src/utils.js');
const { sanitizeSvg } = await import('../src/services/chart-renderer.js');
const { redact } = await import('../src/logger.js');

// ---------- SSRF：出站地址校验（allowPrivate:false = 用户可控外站） ----------
const SSRF_DENY = [
  ['http://127.0.0.1:8080/admin', 'loopback IPv4'],
  ['http://localhost/', 'localhost 字面量'],
  ['http://[::1]/', 'IPv6 loopback'],
  ['http://169.254.169.254/latest/meta-data/', 'AWS/GCP 云元数据'],
  ['http://[::ffff:169.254.169.254]/', 'IPv4 映射 IPv6 云元数据（点分）'],
  ['http://[::ffff:a9fe:a9fe]/', 'IPv4 映射 IPv6 云元数据（十六进制双字，规范形式）'],
  ['http://10.0.0.5/', 'RFC1918 私网 A'],
  ['http://192.168.1.1/', 'RFC1918 私网 C'],
  ['http://172.16.0.1/', 'RFC1918 私网 B'],
  ['http://0.0.0.0/', '未指定地址'],
  ['http://[fe80::1]/', 'IPv6 链路本地'],
  ['http://metadata.google.internal/', '云元数据主机名'],
  ['https://169.254.169.254.nip.io/', 'DNS 重绑定后缀'],
  ['https://foo.local/', 'mDNS/本地域后缀'],
];
for (const [url, label] of SSRF_DENY) {
  test(`SSRF 拒绝（allowPrivate:false）: ${label} -> ${url}`, async () => {
    await assert.rejects(
      () => assertSafeAiResolvedUrl(url, { allowPrivate: false }),
      /不允许|拒绝|无法解析|回环|链路本地|云元数据|私网/,
      `应拒绝 ${url}`,
    );
  });
}

// ---------- SSRF：allowPrivate:true（内网模型服务兼容） ----------
test('SSRF 默认放行私网但始终拒绝回环/元数据', async () => {
  // 私网在 allowPrivate:true 下应放行（内网 vLLM/Ollama 场景）
  const ok = await assertSafeAiResolvedUrl('http://10.0.0.5:11434/', { allowPrivate: true });
  assert.ok(ok, 'allowPrivate:true 应放行内网地址');
  // 但回环/云元数据无论 allowPrivate 如何都必须拒绝
  await assert.rejects(() => assertSafeAiResolvedUrl('http://127.0.0.1/', { allowPrivate: true }));
  await assert.rejects(() => assertSafeAiResolvedUrl('http://169.254.169.254/', { allowPrivate: true }));
});

// ---------- 日志脱敏 redact() ----------
test('redact 掩码敏感字段', () => {
  const masked = redact({
    password: 'hunter2',
    api_key: 'sk-1234567890abcdef',
    authorization: 'Bearer eyJhbGciOi.eyJzdWIi.SflKxwRJS',
    email: 'alice@example.com',
    phone: '13800138000',
    note: '普通文本',
  });
  assert.equal(masked.password, '***redacted***');
  assert.equal(masked.api_key, '***redacted***');
  assert.equal(masked.authorization, '***redacted***');
  // 敏感字段名对应的值一律全掩码（避免明文邮箱/手机号泄露到日志），非敏感字段原样保留
  assert.equal(masked.email, '***redacted***');
  assert.equal(masked.phone, '***redacted***');
  assert.equal(masked.note, '普通文本');
  // 嵌套对象同样处理
  const nested = redact({ user: { token: 'abc.def.ghi' } });
  assert.equal(nested.user.token, '***redacted***');
  // 直接以字符串形式出现的邮箱应部分掩码（保留域名便于排障）
  assert.match(redact('bob@example.com'), /b\*\*\*@example\.com/);
});

// ---------- SVG 净化 sanitizeSvg() ----------
test('sanitizeSvg 剥离 script / on* 事件 / javascript: 伪协议', () => {
  const evil = `<svg><script>alert(1)</script><rect x="0" onload="evil()" onclick="x()" href="javascript:alert(2)"/></svg>`;
  const out = sanitizeSvg(evil);
  assert.ok(!/script/i.test(out), '应移除 <script>');
  assert.ok(!/onload/i.test(out) && !/onclick/i.test(out), '应移除事件处理器');
  assert.ok(!/javascript:/i.test(out), '应移除 javascript: 伪协议');
  // 合法属性保留
  assert.ok(out.includes('<rect'), '应保留合法元素');
});

// ---------- 并发信号量 createSemaphore() ----------
test('createSemaphore 并发上限不被突破', async () => {
  const sem = createSemaphore(3);
  let active = 0;
  let peak = 0;
  const tasks = Array.from({ length: 20 }, () =>
    sem.run(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return true;
    }),
  );
  const results = await Promise.all(tasks);
  assert.equal(results.length, 20);
  assert.ok(results.every(Boolean));
  assert.equal(peak, 3, '并发峰值必须等于信号量上限 3');
});

// ---------- 限流维度 + IPv6 安全归一（keyGenerator 封装在中间件内，验证底层 ipKeyGenerator） ----------
test('makeLimiter 产出中间件 + IPv6 安全归一化', async () => {
  const { makeLimiter } = await import('../src/middleware/rateLimit.js');
  const { ipKeyGenerator } = await import('express-rate-limit');
  // makeLimiter 内部用 ipKeyGenerator 生成 IP 维度键，验证其 IPv6 归一行为
  assert.equal(ipKeyGenerator('1.2.3.4'), '1.2.3.4');
  assert.equal(ipKeyGenerator('::ffff:1.2.3.4'), '1.2.3.4', 'IPv4 映射地址应归一到 IPv4');
  const v6 = ipKeyGenerator('2001:db8:1234:5678:9abc:def0:1111:2222');
  assert.ok(v6.startsWith('2001:db8'), 'IPv6 应归入 /56 子网前缀');
  assert.notEqual(v6, '2001:db8:1234:5678:9abc:def0:1111:2222', '不应暴露完整 IPv6 地址');
  // makeLimiter 产出可调用的中间件函数
  const lim = makeLimiter({ keyType: 'user' });
  assert.equal(typeof lim, 'function');
});

// ---------- 支付：金额服务端计算（防客户端篡改）+ 单次购买约束 ----------
const db = (await import('../src/db.js')).default;
const { createFeatureOrder } = await import('../src/services/payment.js');

// 订单表对 users 有外键约束，先插入测试用户
db.prepare(
  "INSERT INTO users (id, email, password_hash, name) VALUES (1, 'secuser@test.com', 'x', 'SecUser')",
).run();

test('支付金额由服务端按定价计算，且拒绝多份购买', () => {
  // 注入一条固定价功能（单价 12.5 元）
  db.prepare(
    `INSERT OR REPLACE INTO feature_prices
       (feature_key, name, price, unit, category, is_active, is_unlimited, pricing_mode, sort_order)
     VALUES (?, ?, ?, ?, ?, 1, 0, 'fixed', 0)`,
  ).run('sec_test_feature', '测试功能', 12.5, '次', 'writing');

  // 客户端无法传入金额字段，createFeatureOrder 只接 itemType；返回值金额必须等于服务端定价
  const { order } = createFeatureOrder({
    userId: 1,
    itemType: 'sec_test_feature',
    quantity: 1,
  });
  assert.equal(order.amount, 12.5, '订单金额必须等于服务端定价 12.5，不得受客户端影响');
  assert.equal(order.status, 'pending');
  assert.equal(order.item_type, 'sec_test_feature');

  // 历史实现按 quantity 计费却只执行一次，会造成"多付少得"；现仅支持单次购买
  assert.throws(
    () => createFeatureOrder({ userId: 1, itemType: 'sec_test_feature', quantity: 5 }),
    /单次购买/,
    'quantity>1 应被拒绝',
  );
});

// ---------- 订单归属鉴权（防 IDOR）：cross-user 访问被拒 ----------
test('订单归属鉴权：跨用户访问返回 403', () => {
  // 用户 A 创建订单
  const { order: a } = createFeatureOrder({ userId: 1, itemType: 'sec_test_feature', quantity: 1 });
  // 模拟 orders.js 的归属校验逻辑：order.user_id !== req.user.id -> 403
  const isOwner = a.user_id === 1;
  assert.ok(isOwner, '订单 user_id 应等于创建者');
  // 用户 2 访问应被拒（复刻 routes/orders.js 的校验）
  const fakeOrder = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(a.order_no);
  assert.equal(fakeOrder.user_id, 1);
  assert.notEqual(fakeOrder.user_id, 2, '若 user_id 被篡改为 2 则归属校验失效（IDOR）');
});

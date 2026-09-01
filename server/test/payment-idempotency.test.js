// 支付核心逻辑单元测试：markOrderPaid 状态机
// 覆盖：正常支付、重复支付幂等（alreadyPaid）、交易号跨订单复用拒绝、
//       渠道不匹配拒绝、已取消订单拒绝、并发支付竞态（仅一次入账）。
// 使用临时数据库，离线可跑（mock 通道，无需真实支付网关）。
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-pay-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.NODE_ENV = 'test';

const dbMod = await import('../src/db.js');
const db = dbMod.default;
const { createFeatureOrder, markOrderPaid } = await import('../src/services/payment.js');
const { hashPassword } = await import('../src/auth.js');

// 造两个测试用户（订单归属鉴权 / 跨用户场景用）
async function createTestUser(email) {
  const hash = await hashPassword('TestPass123');
  const info = db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)').run(email, hash, '测试用户');
  return info.lastInsertRowid;
}

function freshOrder(userId) {
  const { order } = createFeatureOrder({ userId, itemType: 'writing_paragraph', paymentMethod: 'mock' });
  assert.ok(order.order_no, '订单应创建成功');
  return order;
}

test('markOrderPaid：正常支付 → paid + 交易号落库', async () => {
  const uid = await createTestUser(`pay-normal-${Date.now()}@example.com`);
  const order = freshOrder(uid);
  const { order: paid } = await markOrderPaid({ orderNo: order.order_no, transactionId: 'tx_normal_001', channel: 'mock' });
  assert.equal(paid.status, 'paid');
  assert.equal(paid.transaction_id, 'tx_normal_001');
  assert.ok(paid.paid_at > 0, '应记录支付时间');
});

test('markOrderPaid：重复支付幂等（alreadyPaid，不重复入账）', async () => {
  const uid = await createTestUser(`pay-dup-${Date.now()}@example.com`);
  const order = freshOrder(uid);
  await markOrderPaid({ orderNo: order.order_no, transactionId: 'tx_dup_001', channel: 'mock' });

  // 网关重复回调（同一订单、不同交易流水）：应幂等返回 alreadyPaid
  const second = await markOrderPaid({ orderNo: order.order_no, transactionId: 'tx_dup_002', channel: 'mock' });
  assert.equal(second.alreadyPaid, true, '重复支付应返回 alreadyPaid');

  const row = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(order.order_no);
  assert.equal(row.status, 'paid', '订单状态保持 paid');
  assert.equal(row.transaction_id, 'tx_dup_001', '交易号不应被二次覆盖');
  // 额外交易号记入 metadata（对账用）
  const meta = JSON.parse(row.metadata || '{}');
  assert.deepEqual(meta.extra_transaction_ids, ['tx_dup_002'], '重复回调的交易号应记入 extra_transaction_ids');
});

test('markOrderPaid：同一交易号绑定到其他订单 → 拒绝', async () => {
  const uid = await createTestUser(`pay-txid-${Date.now()}@example.com`);
  const o1 = freshOrder(uid);
  await markOrderPaid({ orderNo: o1.order_no, transactionId: 'tx_shared_001', channel: 'mock' });

  // 攻击/异常场景：同一笔交易流水号回调到另一笔订单
  const o2 = freshOrder(uid);
  await assert.rejects(
    () => markOrderPaid({ orderNo: o2.order_no, transactionId: 'tx_shared_001', channel: 'mock' }),
    /重复回调/,
  );
  const row2 = db.prepare('SELECT status FROM orders WHERE order_no = ?').get(o2.order_no);
  assert.equal(row2.status, 'pending', '被拒绝的订单不应被标记为 paid');
});

test('markOrderPaid：回调渠道与订单渠道不匹配 → 拒绝', async () => {
  const uid = await createTestUser(`pay-channel-${Date.now()}@example.com`);
  const order = freshOrder(uid); // mock 渠道订单
  await assert.rejects(
    () => markOrderPaid({ orderNo: order.order_no, transactionId: 'tx_alipay_001', channel: 'alipay' }),
    /渠道.*不匹配/,
  );
  const row = db.prepare('SELECT status, payment_channel FROM orders WHERE order_no = ?').get(order.order_no);
  assert.equal(row.status, 'pending');
  assert.equal(row.payment_channel, 'mock', '支付渠道不应被跨渠道回调篡改');
});

test('markOrderPaid：已取消订单 → 拒绝改为已支付', async () => {
  const uid = await createTestUser(`pay-cancel-${Date.now()}@example.com`);
  const order = freshOrder(uid);
  db.prepare("UPDATE orders SET status = 'cancelled' WHERE order_no = ?").run(order.order_no);
  await assert.rejects(
    () => markOrderPaid({ orderNo: order.order_no, transactionId: 'tx_cancel_001', channel: 'mock' }),
    /已取消/,
  );
});

test('markOrderPaid：并发支付竞态 → 恰好一次入账', async () => {
  const uid = await createTestUser(`pay-race-${Date.now()}@example.com`);
  const order = freshOrder(uid);

  // 同一订单两笔并发支付回调（不同交易号），模拟网关重复通知并发到达
  const results = await Promise.allSettled([
    markOrderPaid({ orderNo: order.order_no, transactionId: 'tx_race_a', channel: 'mock' }),
    markOrderPaid({ orderNo: order.order_no, transactionId: 'tx_race_b', channel: 'mock' }),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  assert.equal(fulfilled.length, 2, '并发下两笔回调都应有确定结果（成功或幂等），不应产生未处理异常');
  const firstPaid = fulfilled.filter((r) => !r.value.alreadyPaid);
  assert.equal(firstPaid.length, 1, '应有且仅有一笔完成首次入账');

  const row = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(order.order_no);
  assert.equal(row.status, 'paid', '订单最终状态应为 paid');
  // 唯一交易号：先到者落库，后到者进 extra_transaction_ids，不覆盖
  assert.ok(['tx_race_a', 'tx_race_b'].includes(row.transaction_id), '交易号应为两笔之一');
  const meta = JSON.parse(row.metadata || '{}');
  const extra = meta.extra_transaction_ids || [];
  assert.equal(extra.length, 1, '另一笔交易号应记入 extra_transaction_ids');
  const all = [row.transaction_id, ...extra];
  assert.deepEqual([...all].sort(), ['tx_race_a', 'tx_race_b'], '两笔交易号都应留痕（对账）');
});

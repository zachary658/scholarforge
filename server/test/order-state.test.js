// 统一订单状态机 + 支付通道安全 + 失败任务分类 单元测试
// 覆盖：
//   1) 订单状态合法/非法转换（assertTransition）
//   2) 支付成功只能从允许状态进入 paid（cancelled/refunded 被拒，409 语义）
//   3) 未知支付通道不能支付（resolveChannel 拒绝，绝不静默回退）
//   4) 服务状态与支付状态解耦（服务失败/完成不改变 orders.status）
//   5) 状态变更写入 order_events 时间线
//   6) 失败任务错误分类（classifyTaskError）
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-state-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.NODE_ENV = 'test';

const dbMod = await import('../src/db.js');
const db = dbMod.default;
const {
  ORDER_STATUS, SERVICE_STATUS, StateTransitionError,
  assertTransition, transitionStatus,
} = await import('../src/services/order-state.js');
const { createFeatureOrder, markOrderPaid } = await import('../src/services/payment.js');
const { classifyTaskError } = await import('../src/services/task-store.js');
const { claimOrderExecution } = await import('../src/services/order-claim.js');
const { hashPassword } = await import('../src/auth.js');

async function createTestUser(email) {
  const hash = await hashPassword('TestPass123');
  const info = db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)').run(email, hash, '测试用户');
  return info.lastInsertRowid;
}

// ---------- 1) 状态机合法/非法转换 ----------
test('assertTransition：合法转换通过', () => {
  assert.equal(assertTransition('order', ORDER_STATUS.PENDING, ORDER_STATUS.PAID), true);
  assert.equal(assertTransition('order', ORDER_STATUS.AWAITING_QUOTE, ORDER_STATUS.QUOTED), true);
  assert.equal(assertTransition('order', ORDER_STATUS.QUOTED, ORDER_STATUS.PAID), true);
  assert.equal(assertTransition('service', SERVICE_STATUS.FAILED, SERVICE_STATUS.PROCESSING), true); // 失败可重试
  assert.equal(assertTransition('service', SERVICE_STATUS.PROCESSING, SERVICE_STATUS.COMPLETED), true);
});

test('assertTransition：非法转换抛 StateTransitionError(409)', () => {
  assert.throws(() => assertTransition('order', ORDER_STATUS.CANCELLED, ORDER_STATUS.PAID), StateTransitionError);
  assert.throws(() => assertTransition('order', ORDER_STATUS.REFUNDED, ORDER_STATUS.PAID), StateTransitionError);
  assert.throws(() => assertTransition('order', ORDER_STATUS.PAID, ORDER_STATUS.PENDING), StateTransitionError);
  assert.throws(() => assertTransition('service', SERVICE_STATUS.COMPLETED, SERVICE_STATUS.PROCESSING), StateTransitionError);
  // 409 语义
  const err = (() => { try { assertTransition('order', ORDER_STATUS.PAID, ORDER_STATUS.CANCELLED); } catch (e) { return e; } })();
  assert.equal(err.statusCode, 409);
});

// ---------- 2) 支付成功只能从允许状态进入 paid ----------
test('markOrderPaid：cancelled 订单不能改为已支付（409 语义）', async () => {
  const uid = await createTestUser(`st-cancel-${Date.now()}@example.com`);
  const { order } = createFeatureOrder({ userId: uid, itemType: 'writing_paragraph', paymentMethod: 'mock' });
  db.prepare("UPDATE orders SET status = 'cancelled' WHERE order_no = ?").run(order.order_no);
  await assert.rejects(
    () => markOrderPaid({ orderNo: order.order_no, transactionId: 'tx_c', channel: 'mock' }),
    (err) => err instanceof StateTransitionError && err.statusCode === 409 && /已取消/.test(err.message),
  );
});

test('markOrderPaid：refunded 订单不能改为已支付', async () => {
  const uid = await createTestUser(`st-refund-${Date.now()}@example.com`);
  const { order } = createFeatureOrder({ userId: uid, itemType: 'writing_paragraph', paymentMethod: 'mock' });
  db.prepare("UPDATE orders SET status = 'refunded' WHERE order_no = ?").run(order.order_no);
  await assert.rejects(() => markOrderPaid({ orderNo: order.order_no, transactionId: 'tx_r', channel: 'mock' }), StateTransitionError);
});

// ---------- 3) 未知支付通道不能支付 ----------
test('createFeatureOrder：未知通道被拒绝，绝不静默回退', async () => {
  const uid = await createTestUser(`st-chan-${Date.now()}@example.com`);
  assert.throws(
    () => createFeatureOrder({ userId: uid, itemType: 'writing_paragraph', paymentMethod: 'foobar_unknown' }),
    /支付通道无效/,
  );
  // 未产生任何订单
  const c = db.prepare('SELECT COUNT(*) AS c FROM orders WHERE user_id = ?').get(uid).c;
  assert.equal(c, 0, '未知通道被拒后不应创建订单');
});

// ---------- 4) 服务状态与支付状态解耦 ----------
test('服务失败/完成不改变支付状态（status 与 service_status 独立）', async () => {
  const uid = await createTestUser(`st-svc-${Date.now()}@example.com`);
  const { order } = createFeatureOrder({ userId: uid, itemType: 'writing_paragraph', paymentMethod: 'mock' });
  await markOrderPaid({ orderNo: order.order_no, transactionId: 'tx_svc', channel: 'mock' });

  // 抢占执行：service_status pending → processing
  const full = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(order.order_no);
  assert.equal(full.status, 'paid');
  assert.equal(full.service_status, 'pending');
  assert.equal(claimOrderExecution(full), true);
  const afterClaim = db.prepare('SELECT status, service_status FROM orders WHERE order_no = ?').get(order.order_no);
  assert.equal(afterClaim.status, 'paid', '服务状态变更不影响支付状态');
  assert.equal(afterClaim.service_status, 'processing');

  // 服务失败
  transitionStatus({
    domain: 'service', table: 'orders', recordId: full.id, field: 'service_status',
    toStatus: 'failed', fromStatus: 'processing', orderId: full.id, orderNo: order.order_no,
  });
  const afterFail = db.prepare('SELECT status, service_status FROM orders WHERE order_no = ?').get(order.order_no);
  assert.equal(afterFail.status, 'paid', '服务失败绝不能改变支付状态');
  assert.equal(afterFail.service_status, 'failed');
});

// ---------- 5) order_events 时间线 ----------
test('状态变更写入 order_events（含操作人/旧值/新值/原因）', async () => {
  const uid = await createTestUser(`st-evt-${Date.now()}@example.com`);
  const { order } = createFeatureOrder({ userId: uid, itemType: 'writing_paragraph', paymentMethod: 'mock' });
  await markOrderPaid({ orderNo: order.order_no, transactionId: 'tx_evt', channel: 'mock' });

  const evts = db.prepare(
    "SELECT * FROM order_events WHERE order_id = ? AND field = 'status' ORDER BY id DESC"
  ).all(order.id);
  assert.ok(evts.length >= 1, '支付应写入状态事件');
  const payEvt = evts[0];
  assert.equal(payEvt.to_status, 'paid');
  assert.equal(payEvt.domain, 'order');
  assert.ok(payEvt.from_status === 'pending', `from 应为 pending，实际 ${payEvt.from_status}`);
  assert.ok(payEvt.created_at > 0, '应记录时间');
});

// ---------- 6) 失败任务错误分类 ----------
test('classifyTaskError：网络超时/AI 暂不可用可重试，其余联系客服', () => {
  assert.deepEqual(classifyTaskError(new Error('Request timeout after 30000ms')), { code: 'network_timeout', retryable: true, label: '网络超时，请重试' });
  assert.deepEqual(classifyTaskError(new Error('AI 服务暂不可用')), { code: 'ai_unavailable', retryable: true, label: 'AI 服务暂不可用' });
  assert.deepEqual(classifyTaskError(new Error('输入内容过长')), { code: 'input_too_long', retryable: false, label: '输入内容过长' });
  assert.deepEqual(classifyTaskError(new Error('资料解析失败')), { code: 'material_parse_failed', retryable: false, label: '资料解析失败' });
  assert.deepEqual(classifyTaskError(new Error('订单状态异常')), { code: 'order_error', retryable: false, label: '余额或订单异常' });
  assert.deepEqual(classifyTaskError(new Error('some random crash')), { code: 'internal_error', retryable: false, label: '系统内部错误' });
});

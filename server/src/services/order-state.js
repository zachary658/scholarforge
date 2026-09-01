// 统一订单状态机：订单/服务/客服状态变更的唯一入口
// 职责：
//   1. 集中定义合法状态与前置状态转换表，禁止散落的状态写入
//   2. 每次状态变更校验合法性（非法转换抛 StateTransitionError，HTTP 语义 409）
//   3. 每次状态变更写入 order_events 时间线（操作人/旧值/新值/原因/时间）
//   4. 提供历史状态值的迁移兼容映射（订单 status 历史曾混入 processing/completed）
import db from '../db.js';
import { now } from '../utils.js';
import { getSetting } from '../config-store.js';

// ===== 状态常量 =====
// 订单主状态（orders.status）：支付生命周期。pending 即「待支付」。
export const ORDER_STATUS = {
  AWAITING_QUOTE: 'awaiting_quote', // 待报价（人工报价流程）
  QUOTED: 'quoted',                 // 已报价，待用户接受并支付
  PENDING: 'pending',               // 待支付
  PAID: 'paid',                     // 已支付
  CANCELLED: 'cancelled',           // 已取消
  REFUNDED: 'refunded',             // 已退款
};

// 服务状态（orders.service_status）：支付后的履约进度，与支付状态完全解耦
export const SERVICE_STATUS = {
  PENDING: 'pending',             // 未开始
  QUEUED: 'queued',               // 已排队
  PROCESSING: 'processing',       // 处理中
  AWAITING_CUSTOMER: 'awaiting_customer', // 等待客户补充
  COMPLETED: 'completed',         // 已完成
  FAILED: 'failed',               // 失败（可重试）
  AFTER_SALES: 'after_sales',     // 售后
  CLOSED: 'closed',               // 已关闭
};

// 客服状态（contact_status / user_courses.contact_status）
export const CONTACT_STATUS = {
  PENDING: 'pending',       // 待对接
  CONTACTED: 'contacted',   // 已对接
  IN_SERVICE: 'in_service', // 服务中
  COMPLETED: 'completed',   // 已完成（历史值）
  CLOSED: 'closed',         // 已关闭
};

// ===== 历史状态值迁移兼容 =====
// 订单 status 历史实现曾把服务进度（processing/completed）混入 status；
// 归一时二者均视为「已支付」，仅允许走向 refunded。
const ORDER_STATUS_ALIAS = {
  processing: ORDER_STATUS.PAID,
  completed: ORDER_STATUS.PAID,
};

// ===== 合法转换表 =====
// 订单主状态：支付生命周期（仅允许的下一步）
const ORDER_TRANSITIONS = {
  [null]: [ORDER_STATUS.PENDING, ORDER_STATUS.AWAITING_QUOTE],
  [ORDER_STATUS.PENDING]: [ORDER_STATUS.PAID, ORDER_STATUS.CANCELLED, ORDER_STATUS.AWAITING_QUOTE],
  [ORDER_STATUS.AWAITING_QUOTE]: [ORDER_STATUS.QUOTED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.QUOTED]: [ORDER_STATUS.PAID, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PAID]: [ORDER_STATUS.REFUNDED],
  [ORDER_STATUS.CANCELLED]: [],
  [ORDER_STATUS.REFUNDED]: [],
};

// 服务状态：履约进度（服务失败/完成绝不改变支付状态，二者独立维度）
const SERVICE_TRANSITIONS = {
  [null]: [SERVICE_STATUS.PENDING],
  [SERVICE_STATUS.PENDING]: [SERVICE_STATUS.QUEUED, SERVICE_STATUS.PROCESSING, SERVICE_STATUS.AWAITING_CUSTOMER],
  [SERVICE_STATUS.QUEUED]: [SERVICE_STATUS.PROCESSING],
  [SERVICE_STATUS.PROCESSING]: [
    SERVICE_STATUS.COMPLETED,
    SERVICE_STATUS.FAILED,
    SERVICE_STATUS.AWAITING_CUSTOMER,
    SERVICE_STATUS.AFTER_SALES,
  ],
  [SERVICE_STATUS.AWAITING_CUSTOMER]: [SERVICE_STATUS.PROCESSING, SERVICE_STATUS.COMPLETED, SERVICE_STATUS.CLOSED],
  [SERVICE_STATUS.FAILED]: [SERVICE_STATUS.PROCESSING], // 失败可重试（重新抢占执行）
  [SERVICE_STATUS.COMPLETED]: [SERVICE_STATUS.AFTER_SALES],
  [SERVICE_STATUS.AFTER_SALES]: [SERVICE_STATUS.CLOSED],
  [SERVICE_STATUS.CLOSED]: [],
};

// 客服状态：对接进度
const CONTACT_TRANSITIONS = {
  [null]: [CONTACT_STATUS.PENDING],
  [CONTACT_STATUS.PENDING]: [CONTACT_STATUS.CONTACTED, CONTACT_STATUS.CLOSED],
  [CONTACT_STATUS.CONTACTED]: [CONTACT_STATUS.IN_SERVICE, CONTACT_STATUS.CLOSED],
  [CONTACT_STATUS.IN_SERVICE]: [CONTACT_STATUS.COMPLETED, CONTACT_STATUS.CLOSED],
  [CONTACT_STATUS.COMPLETED]: [CONTACT_STATUS.CLOSED],
  [CONTACT_STATUS.CLOSED]: [],
};

const TRANSITIONS = {
  order: ORDER_TRANSITIONS,
  service: SERVICE_TRANSITIONS,
  contact: CONTACT_TRANSITIONS,
};

// ===== 状态冲突错误（HTTP 409） =====
export class StateTransitionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StateTransitionError';
    this.statusCode = 409;
  }
}

// 归一化历史状态值（订单 status 历史曾混入 processing/completed）
function normalize(domain, status) {
  if (domain === 'order' && status != null && ORDER_STATUS_ALIAS[status]) {
    return ORDER_STATUS_ALIAS[status];
  }
  return status;
}

// 校验状态转换合法性（不执行写入）。非法抛 StateTransitionError。
export function assertTransition(domain, from, to) {
  const table = TRANSITIONS[domain];
  if (!table) throw new StateTransitionError(`未知状态域：${domain}`);
  const normalizedFrom = normalize(domain, from);
  const allowed = table[normalizedFrom] || [];
  if (!allowed.includes(to)) {
    throw new StateTransitionError(`非法状态转换：${from ?? '(空)'} → ${to}`);
  }
  return true;
}

// 写入状态事件时间线（供管理后台展示完整状态历史）
export function recordOrderEvent({
  orderId = null,
  orderNo = null,
  domain,
  refType,
  refId,
  field,
  fromStatus,
  toStatus,
  operatorId = null,
  operatorName = null,
  reason = '',
}) {
  db.prepare(
    `INSERT INTO order_events
      (order_id, order_no, domain, ref_type, ref_id, field, from_status, to_status, operator_id, operator_name, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    orderId, orderNo, domain, refType, refId, field,
    fromStatus == null ? null : String(fromStatus),
    String(toStatus),
    operatorId, operatorName, reason || '', now()
  );
}

// 统一状态变更：校验 + 单表 UPDATE + 记录事件（原子性由调用方保证，事务内也可调用）
// 适用场景：orders.service_status、contact_status、quote_status 等单表单字段状态切换。
// 返回 { from, to }；非法转换抛 StateTransitionError。
export function transitionStatus({
  domain,
  table,
  refType = table,
  recordId,
  field,
  toStatus,
  // 可选：期望的当前状态（乐观锁）。指定后若当前状态不匹配则抛冲突。
  fromStatus = null,
  // 额外 WHERE 条件（如 user_id 归属校验），用数组 [sqlFragment, ...params]
  extraWhere = null,
  operatorId = null,
  operatorName = null,
  reason = '',
  orderId = null,
  orderNo = null,
}) {
  // 表/字段白名单：杜绝 SQL 注入（仅允许代码内固定传入的表/字段）
  const ALLOWED_TABLES = new Set([
    'orders', 'graduation_project_orders', 'patent_orders', 'publication_orders', 'user_courses',
  ]);
  const ALLOWED_FIELDS = new Set(['status', 'service_status', 'contact_status', 'quote_status']);
  if (!ALLOWED_TABLES.has(table)) throw new Error(`非法状态表：${table}`);
  if (!ALLOWED_FIELDS.has(field)) throw new Error(`非法状态字段：${field}`);

  const col = field; // 已白名单校验
  const row = db.prepare(`SELECT ${col} AS s FROM ${table} WHERE id = ?`).get(recordId);
  if (!row) throw new StateTransitionError('记录不存在');
  const from = row.s;

  // 校验转换合法性
  assertTransition(domain, from, toStatus);
  // 乐观锁：指定期望状态时校验，防并发覆盖
  if (fromStatus != null && from !== fromStatus) {
    throw new StateTransitionError(`状态已变更：当前 ${from}，期望 ${fromStatus}`);
  }

  // 执行更新（额外 WHERE 用于归属/状态二次校验）
  let where = 'id = ?';
  let params = [recordId];
  if (extraWhere) {
    where += ` AND ${extraWhere[0]}`;
    params = params.concat(extraWhere.slice(1));
  }

  // 更新 + 事件写入在同一 SQLite 事务内：任一失败则整体回滚，杜绝「状态已变但无时间线」。
  const tx = db.transaction(() => {
    const r = db.prepare(`UPDATE ${table} SET ${col} = ? WHERE ${where}`).run(toStatus, ...params);
    if (r.changes === 0) {
      throw new StateTransitionError(`状态已变更（并发冲突）：${from}`);
    }
    recordOrderEvent({
      orderId, orderNo, domain, refType, refId: recordId, field: col,
      fromStatus: from, toStatus, operatorId, operatorName, reason,
    });
    return { from, to: toStatus };
  });
  return tx();
}

// ===== orders 表专用状态转换（唯一入口，禁止其他文件直接 UPDATE orders.status / service_status）=====

// 订单卡死判定超时：processing 超过该时长视为「卡死」，允许抢占重试。
function getOrderClaimTimeoutSec() {
  const min = parseInt(getSetting('order_claim_timeout_min', '30'), 10);
  return (Number.isFinite(min) && min > 0 ? min : 30) * 60;
}

// 服务状态 → processing：原子抢占执行权（pending/failed → processing；processing 超时也允许抢占）。
// 返回 true 表示本调用获得执行权；false 表示订单正被其他请求处理中。
export function transitionServiceToProcessing(order, { projectId = null } = {}) {
  if (!order) return true;
  const cur = db.prepare('SELECT service_status AS s FROM orders WHERE id = ?').get(order.id);
  const from = cur ? cur.s : null;
  const tx = db.transaction(() => {
    const r = db.prepare(
      `UPDATE orders SET service_status = 'processing', updated_at = ?, project_id = COALESCE(?, project_id)
        WHERE id = ? AND (service_status IN ('pending', 'failed')
               OR (service_status = 'processing' AND (updated_at IS NULL OR updated_at < ?)))`
    ).run(now(), projectId, order.id, now() - getOrderClaimTimeoutSec());
    if (r.changes !== 1) return false;
    recordOrderEvent({
      orderId: order.id, orderNo: order.order_no, domain: 'service', refType: 'orders', refId: order.id,
      field: 'service_status', fromStatus: from, toStatus: 'processing',
      operatorId: null, operatorName: 'system',
      reason: from === 'failed' ? '失败后重新执行' : '开始执行',
    });
    return true;
  });
  return tx();
}

// 服务状态 → failed：仅当当前为 processing（并发下跳过不抛错）。
export function transitionServiceToFailed(orderId, { reason = 'AI 执行失败' } = {}) {
  const tx = db.transaction(() => {
    const r = db.prepare("UPDATE orders SET service_status = 'failed' WHERE id = ? AND service_status = 'processing'").run(orderId);
    if (r.changes !== 1) return false;
    const o = db.prepare('SELECT order_no FROM orders WHERE id = ?').get(orderId);
    recordOrderEvent({
      orderId, orderNo: o?.order_no ?? null, domain: 'service', refType: 'orders', refId: orderId,
      field: 'service_status', fromStatus: 'processing', toStatus: 'failed',
      operatorId: null, operatorName: 'system', reason,
    });
    return true;
  });
  return tx();
}

// 服务状态 → completed：仅当当前为 processing（可附带 task_id）。
export function transitionServiceToCompleted(orderId, { taskId = null, reason = '生成完成' } = {}) {
  const tx = db.transaction(() => {
    const r = db.prepare(
      "UPDATE orders SET service_status = 'completed', task_id = ? WHERE id = ? AND service_status = 'processing'"
    ).run(taskId, orderId);
    if (r.changes !== 1) return false;
    const o = db.prepare('SELECT order_no FROM orders WHERE id = ?').get(orderId);
    recordOrderEvent({
      orderId, orderNo: o?.order_no ?? null, domain: 'service', refType: 'orders', refId: orderId,
      field: 'service_status', fromStatus: 'processing', toStatus: 'completed',
      operatorId: null, operatorName: 'system', reason,
    });
    return true;
  });
  return tx();
}

// 订单 → paid（支付成功）：原子地把状态改为 paid 并记录事件；effects 回调在事务内执行，
// 保证「状态更新 + 业务副作用（发课程/关联子订单）」原子一致。
export function transitionOrderToPaid(order, { transactionId = null, channel = null, effects = null } = {}) {
  const tx = db.transaction(() => {
    const r = db.prepare(
      `UPDATE orders SET status = 'paid', paid_at = ?, transaction_id = COALESCE(?, transaction_id),
       payment_channel = COALESCE(?, payment_channel), service_status = 'pending'
       WHERE order_no = ? AND status NOT IN ('paid', 'completed', 'cancelled', 'refunded')`
    ).run(now(), transactionId, channel, order.order_no);
    if (r.changes === 0) {
      throw new StateTransitionError(`订单状态已变更，当前状态：${db.prepare('SELECT status FROM orders WHERE order_no = ?').get(order.order_no)?.status}`);
    }
    recordOrderEvent({
      orderId: order.id, orderNo: order.order_no, domain: 'order', refType: 'orders', refId: order.id,
      field: 'status', fromStatus: order.status, toStatus: 'paid',
      operatorId: null, operatorName: channel || 'payment',
      reason: transactionId ? `支付成功，交易号 ${transactionId}` : '支付成功',
    });
    if (typeof effects === 'function') effects();
  });
  tx();
}

export default {
  ORDER_STATUS,
  SERVICE_STATUS,
  CONTACT_STATUS,
  StateTransitionError,
  assertTransition,
  recordOrderEvent,
  transitionStatus,
  transitionServiceToProcessing,
  transitionServiceToFailed,
  transitionServiceToCompleted,
  transitionOrderToPaid,
};

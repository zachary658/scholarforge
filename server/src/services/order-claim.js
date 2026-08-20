// 订单执行权抢占（现金直付订单的原子并发控制）
// 此前 tools.js 与 chapter-service.js 各有一份重复实现，导致一处修复漏改另一处（见 commit a67dabe）。
// 统一在此，避免再次出现「改了一处、漏了另一处」的隐患。
import db from '../db.js';
import { now } from '../utils.js';
import { getSetting } from '../config-store.js';

// 订单卡死判定超时：进入 processing 超过该时长视为「卡死」（进程崩溃/重启遗留），允许抢占重试。
// 默认 30 分钟，可经 settings 表 order_claim_timeout_min（分钟）配置。
function getOrderClaimTimeoutSec() {
  const min = parseInt(getSetting('order_claim_timeout_min', '30'), 10);
  return (Number.isFinite(min) && min > 0 ? min : 30) * 60;
}

/**
 * 原子抢占订单执行权：pending/failed → processing；processing 超时（卡死）也允许抢占。
 * 同时更新 updated_at 用于超时判定；projectId 非空时绑定（分章节生成防「一单多论文」）。
 * @param {object} order 订单记录（可为 null，null 时视为无订单直接放行）
 * @param {object} opts { projectId } 可选，绑定订单到指定论文工作区
 * @returns {boolean} true 表示本请求获得执行权；false 表示订单正被其他请求处理中
 */
export function claimOrderExecution(order, { projectId = null } = {}) {
  if (!order) return true;
  const r = db.prepare(
    `UPDATE orders
        SET service_status = 'processing', updated_at = ?,
            project_id = COALESCE(?, project_id)
      WHERE id = ?
        AND (service_status IN ('pending', 'failed')
             OR (service_status = 'processing' AND (updated_at IS NULL OR updated_at < ?)))`
  ).run(now(), projectId, order.id, now() - getOrderClaimTimeoutSec());
  return r.changes === 1;
}

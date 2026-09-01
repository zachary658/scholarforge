// 订单执行权抢占（现金直付订单的原子并发控制）
// 此前 tools.js 与 chapter-service.js 各有一份重复实现，导致一处修复漏改另一处（见 commit a67dabe）。
// 现统一收敛到 order-state.js 的 transitionServiceToProcessing，本模块仅作兼容转发，
// 禁止在此或任何其他文件直接 UPDATE orders.service_status。
import { transitionServiceToProcessing } from './order-state.js';

/**
 * 原子抢占订单执行权：pending/failed → processing；processing 超时（卡死）也允许抢占。
 * @param {object} order 订单记录（可为 null，null 时视为无订单直接放行）
 * @param {object} opts { projectId } 可选，绑定订单到指定论文工作区
 * @returns {boolean} true 表示本请求获得执行权；false 表示订单正被其他请求处理中
 */
export function claimOrderExecution(order, { projectId = null } = {}) {
  return transitionServiceToProcessing(order, { projectId });
}

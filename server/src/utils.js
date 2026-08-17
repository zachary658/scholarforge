/**
 * 公共工具函数
 * 避免各模块重复定义 now()、时间格式化等
 */

/** 当前 Unix 时间戳（秒） */
export function now() {
  return Math.floor(Date.now() / 1000);
}

/** 当前日期字符串 YYYYMMDD（用于订单号前缀） */
export function datePrefix() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
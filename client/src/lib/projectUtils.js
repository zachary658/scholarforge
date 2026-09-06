// 论文工作区共享工具：字段常量与时间格式化（列表/详情/弹窗共用）

export const FIELDS = [
  '计算机科学', '电子信息', '机械工程', '材料科学', '生物医学',
  '化学', '物理学', '数学', '经济学', '管理学',
  '法学', '文学', '历史学', '哲学', '教育学', '其他',
];

export const DEGREES = ['本科', '硕士', '博士', '其他'];

export function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 截止时间：Unix 秒级时间戳 ↔ <input type="date"> 的 YYYY-MM-DD 互转
export function tsToDate(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dateToTs(dateStr) {
  if (!dateStr) return null;
  const t = new Date(`${dateStr}T23:59:59`).getTime() / 1000;
  return Number.isFinite(t) ? Math.floor(t) : null;
}

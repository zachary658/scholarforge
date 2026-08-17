// 课程定制报价服务（论文 1 对 1 指导）
// 基础价来自课程"起"价（courses.price），用户填写的需求项在其上累加：
//   字数超出基准 → 按每万字加价；图表/图纸 → 按张加价；公式复杂度 → 分级加价；加急 → 小计乘系数
// 金额由服务端权威计算，前端报价仅作展示，下单时后端会重新计算，防止客户端篡改价格。
import { getCourseQuoteConfig } from '../config-store.js';

const PAPER_TYPES = ['毕业论文', '课程论文', '期刊论文', '其他'];
const FORMULA_LEVELS = ['无', '少量', '较多', '大量'];

function toInt(v, fallback = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(max, n));
}

// 规范化并校验需求字段，返回安全的需求对象（用于存储与展示）
export function normalizeCourseRequirements(input = {}) {
  const major = String(input.major || '').trim().slice(0, 100);
  if (!major) {
    const err = new Error('请填写专业方向');
    err.status = 400;
    throw err;
  }

  const paperType = PAPER_TYPES.includes(input.paper_type) ? input.paper_type : '毕业论文';
  const formula = FORMULA_LEVELS.includes(input.formula) ? input.formula : '无';

  return {
    major,
    paper_type: paperType,
    word_count: toInt(input.word_count, 0, 1000000),
    chart_count: toInt(input.chart_count, 0, 100),
    drawing_count: toInt(input.drawing_count, 0, 100),
    formula,
    urgent: !!input.urgent,
    note: String(input.note || '').trim().slice(0, 2000),
    contact: String(input.contact || '').trim().slice(0, 200),
  };
}

// 计算报价：返回金额与明细（金额均为元，保留两位小数）
export function computeCourseQuote(course, input = {}) {
  const requirements = normalizeCourseRequirements(input);
  const cfg = getCourseQuoteConfig(course);

  const base = Math.max(0, Number(course.price) || 0);
  const breakdown = [{ label: `基础指导价（${course.degree || '本课程'}起）`, amount: base }];

  // 字数加价：超出基准字数，按每满 1 万字向上取整计费
  const extraWords = Math.max(0, requirements.word_count - cfg.baseWordCount);
  let wordExtra = 0;
  if (extraWords > 0 && cfg.wordPrice > 0) {
    const tenThousands = Math.ceil(extraWords / 10000);
    wordExtra = tenThousands * cfg.wordPrice;
    breakdown.push({ label: `字数加价（${requirements.word_count} 字）`, amount: wordExtra });
  }

  // 图表加价
  let chartExtra = 0;
  if (requirements.chart_count > 0 && cfg.chartPrice > 0) {
    chartExtra = requirements.chart_count * cfg.chartPrice;
    breakdown.push({ label: `图表加价（${requirements.chart_count} 张）`, amount: chartExtra });
  }

  // 图纸加价
  let drawingExtra = 0;
  if (requirements.drawing_count > 0 && cfg.drawingPrice > 0) {
    drawingExtra = requirements.drawing_count * cfg.drawingPrice;
    breakdown.push({ label: `图纸/示意图加价（${requirements.drawing_count} 张）`, amount: drawingExtra });
  }

  // 公式复杂度加价
  let formulaExtra = 0;
  if (requirements.formula === '少量') formulaExtra = cfg.formulaLow;
  else if (requirements.formula === '较多') formulaExtra = cfg.formulaMid;
  else if (requirements.formula === '大量') formulaExtra = cfg.formulaHigh;
  if (formulaExtra > 0) {
    breakdown.push({ label: `公式/数学推导加价（${requirements.formula}）`, amount: formulaExtra });
  }

  const subtotal = base + wordExtra + chartExtra + drawingExtra + formulaExtra;

  // 加急：小计乘系数
  let total = subtotal;
  if (requirements.urgent && cfg.urgentMultiplier > 1) {
    total = subtotal * cfg.urgentMultiplier;
    breakdown.push({ label: '加急服务费', amount: total - subtotal });
  }

  const amount = Math.round(total * 100) / 100;

  return {
    amount,
    breakdown: breakdown.map((b) => ({ ...b, amount: Math.round(b.amount * 100) / 100 })),
    requirements,
  };
}

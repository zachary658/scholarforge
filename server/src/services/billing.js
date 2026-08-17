// 积分服务（按大模型 token 用量计费）
// 积分制：用户充值获得积分，每次 AI 调用按「预估 token 用量」扣除对应积分
// 计费公式：
//   成本(元) = 输入token/1e6 × 输入单价 + 输出token/1e6 × 输出单价
//   售价(元) = 成本 / (1 - 利润率)          —— 利润率 0.8 时售价 = 成本 × 5
//   积分     = 售价(元) × 10                —— 1 元 = 10 积分
// 免费功能（feature_prices.is_unlimited=1，如大纲生成）：不消耗积分
import db from '../db.js';
import { encode } from 'gpt-tokenizer';
import { getFeaturePrice, getAiPricingConfig } from '../config-store.js';

// ========== 免费功能 ==========

// 判断某功能是否免费且不限次（如大纲生成、文献检索/格式化）
export function isFreeUnlimitedFeature(featureKey) {
  const fp = getFeaturePrice(featureKey);
  return !!(fp && fp.is_active && fp.is_unlimited);
}

// ========== 积分余额 ==========

// 获取用户积分余额
export function getPointsBalance(userId) {
  const u = db.prepare('SELECT points FROM users WHERE id = ?').get(userId);
  return u ? u.points : 0;
}

// 获取用户积分状态
export function getPointsStatus(userId) {
  const balance = getPointsBalance(userId);
  return { balance };
}

// ========== 积分变动 ==========

// 扣减积分（事务保证原子性）
// 返回 { ok, balance_after }；余额不足或并发冲突则抛错
export function consumePoints(userId, points, description = '') {
  const tx = db.transaction(() => {
    const r = db.prepare(
      'UPDATE users SET points = points - ? WHERE id = ? AND points >= ?'
    ).run(points, userId, points);
    if (r.changes === 0) {
      const current = getPointsBalance(userId);
      throw new Error(`积分不足（当前 ${current}，需要 ${points}）`);
    }
    const newBalance = getPointsBalance(userId);
    // 记录积分日志
    db.prepare(
      'INSERT INTO points_log (user_id, type, points, balance_after, description) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, 'consume', -points, newBalance, description);
    return newBalance;
  }, { immediate: true });
  return tx();
}

// 增加积分（充值/赠送/退款）
export function grantPoints(userId, points, type = 'topup', description = '', orderId = null) {
  return db.transaction(() => {
    db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(points, userId);
    const newBalance = getPointsBalance(userId);
    db.prepare(
      'INSERT INTO points_log (user_id, type, points, balance_after, order_id, description) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(userId, type, points, newBalance, orderId, description);
    return newBalance;
  }, { immediate: true })();
}

// 退款：退回积分
export function refundPoints(userId, points, description = '') {
  return grantPoints(userId, points, 'refund', description);
}

// ========== token 预估与积分换算 ==========

// 按字符类型估算一段文本的 token 数
// 使用 OpenAI 官方 BPE 分词器（cl100k_base，gpt-tokenizer）精确计数，替代原「中文×2 + 其他×0.5」启发式，
// 使预扣积分更贴近真实用量（结算阶段仍按 API 返回的真实 token 多退少补）。
export function estimateTextTokens(text) {
  if (!text) return 0;
  try {
    return encode(String(text)).length;
  } catch {
    // 极端情况下回退到保守启发式（中文 2 token/字、其他 0.5 token/字符）
    let cjk = 0;
    let other = 0;
    for (const ch of String(text)) {
      if (/[\u4e00-\u9fa5]/.test(ch)) cjk++;
      else other++;
    }
    return Math.ceil(cjk * 2 + other * 0.5);
  }
}

// 各工具预估输出 token 预算（与 ai-service 的 max_tokens 对齐）
const OUTPUT_TOKEN_BUDGET = {
  writing_outline: 2048,
  writing_paragraph: 2048,
  writing_abstract: 2048,
  writing_fulltext: 16000, // 本科毕业论文全文 12000+ 字
  proposal: 6000,          // 开题报告 10 章节
  literature_review: 6000, // 文献综述 2000-3000 字
  journal: 8000,           // 期刊论文 4000-6000 字
  defense: 6000,           // 答辩 PPT + 演讲稿
  task_book: 4000,         // 任务书
  ai_reduce: 4096,         // 降AI二次改写输出较多
  default: 2048,
};

// system prompt 固定开销估算
// 含图表生成规范（CHART_GUIDE）的写作类工具 system prompt 较长（约 3500 token），
// 其他工具（polish/translate/grammar/rewrite/ai_reduce）较短（约 1200 token）
const CHART_TOOL_TYPES = new Set(['writing', 'proposal', 'literature_review', 'journal', 'task_book', 'defense']);

function systemPromptEstimate(toolType) {
  return CHART_TOOL_TYPES.has(toolType) ? 3500 : 1200;
}

// 预估一次 AI 调用的 token 用量（输入 + 输出）
// toolType: 'writing' | 'proposal' | ... ；params: 调用参数
export function estimateCallTokens(toolType, params = {}) {
  // 输出 token
  let outputTokens = OUTPUT_TOKEN_BUDGET.default;
  if (toolType === 'writing') {
    outputTokens = OUTPUT_TOKEN_BUDGET[`writing_${params?.type}`] || OUTPUT_TOKEN_BUDGET.default;
  } else {
    outputTokens = OUTPUT_TOKEN_BUDGET[toolType] || OUTPUT_TOKEN_BUDGET.default;
  }

  // 输入 token：用户数据（含上下文） + system prompt 固定开销
  const userText = typeof params === 'string' ? params : JSON.stringify(params || {});
  const inputTokens = estimateTextTokens(userText) + systemPromptEstimate(toolType);

  return { inputTokens, outputTokens };
}

// 将 token 用量换算为应扣积分（保证利润率不低于配置值）
export function tokensToPoints(inputTokens, outputTokens) {
  const cfg = getAiPricingConfig();
  // 大模型 API 成本（元）
  const costYuan =
    (inputTokens / 1_000_000) * cfg.inputCostPerMillion +
    (outputTokens / 1_000_000) * cfg.outputCostPerMillion;
  // 售价 = 成本 / (1 - 利润率)，保证利润率
  const priceYuan = costYuan / (1 - cfg.profitMargin);
  // 积分 = 售价 × 10，向上取整，至少 1 积分
  const points = Math.max(1, Math.ceil(priceYuan * cfg.pointsPerYuan));
  return points;
}

// 预估一次调用应扣积分（综合估算）
export function estimatePointsForCall(toolType, params = {}) {
  const { inputTokens, outputTokens } = estimateCallTokens(toolType, params);
  return tokensToPoints(inputTokens, outputTokens);
}

// 判断用户积分是否足够完成一次调用
export function canConsumeTokens(userId, toolType, params = {}) {
  const points = estimatePointsForCall(toolType, params);
  const balance = getPointsBalance(userId);
  if (balance < points) {
    return { ok: false, reason: 'INSUFFICIENT_POINTS', balance, needed: points };
  }
  return { ok: true, source: 'points', balance, points };
}

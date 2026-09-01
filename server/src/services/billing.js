// 现金定价服务（现金直付，非积分）
// 功能定价：固定价格（feature_prices.price，单位元）或人工报价（pricing_mode='quote'）
// 同时保留 token 估算，用于成本监控（不直接扣费）
import { encode } from 'gpt-tokenizer';
import { getFeaturePrice, getAiPricingConfig, getDefaultModel } from '../config-store.js';
import { resolveMaxTokensOverride, effectiveMaxTokens, hasRealAIModel } from '../ai-service.js';

// ========== 免费功能 ==========

// 判断某功能是否免费且不限次（如大纲生成、文献检索/格式化）
export function isFreeUnlimitedFeature(featureKey) {
  const fp = getFeaturePrice(featureKey);
  return !!(fp && fp.is_active && fp.is_unlimited);
}

// 获取某功能的固定现金价格（元；免费/未启用/报价模式返回 0）
export function getFeatureCashPrice(featureKey) {
  const fp = getFeaturePrice(featureKey);
  if (!fp || !fp.is_active || fp.is_unlimited) return 0;
  if (fp.pricing_mode === 'quote') return 0; // 报价模式无固定价，需走人工报价
  return Math.max(0, Number(fp.price) || 0);
}

// ========== token 估算与成本监控（非扣费） ==========

// 按字符类型估算一段文本的 token 数
// 使用 OpenAI 官方 BPE 分词器（cl100k_base，gpt-tokenizer）精确计数
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
const CHART_TOOL_TYPES = new Set(['writing', 'proposal', 'literature_review', 'journal', 'task_book', 'defense']);

function systemPromptEstimate(toolType) {
  return CHART_TOOL_TYPES.has(toolType) ? 3500 : 1200;
}

// 预估一次 AI 调用的 token 用量（输入 + 输出）
export function estimateCallTokens(toolType, params = {}) {
  let outputTokens = OUTPUT_TOKEN_BUDGET.default;
  if (toolType === 'writing') {
    outputTokens = OUTPUT_TOKEN_BUDGET[`writing_${params?.type}`] || OUTPUT_TOKEN_BUDGET.default;
  } else {
    outputTokens = OUTPUT_TOKEN_BUDGET[toolType] || OUTPUT_TOKEN_BUDGET.default;
  }

  // 输出预估与实际生效的 max_tokens 对齐：配置了真实模型时，实际请求的 max_tokens 由
  // ai-service 统一计算（fulltext/revise 有 maxTokensOverride ≥8192，普通工具取模型目录
  // 配置，均受 AI_MAX_OUTPUT_TOKENS 熔断封顶），监控必须跟随该值，否则口径脱钩：
  // 如 revise 在表中无项按 default 2048 估、实际 override 后 ≥8192（严重低估），
  // writing_fulltext 按表 16000 估、实际可能仅 8192（高估）。
  // 未配置真实模型（内置引擎，不发起真实调用）时沿用上表预算估算（表内数字不变）。
  if (hasRealAIModel()) {
    const model = getDefaultModel();
    outputTokens = effectiveMaxTokens(model, resolveMaxTokensOverride(toolType, params, model));
  }

  const userText = typeof params === 'string' ? params : JSON.stringify(params || {});
  const inputTokens = estimateTextTokens(userText) + systemPromptEstimate(toolType);

  return { inputTokens, outputTokens };
}

// 将 token 用量换算为成本金额（元），用于成本监控
export function tokensToCostYuan(inputTokens, outputTokens) {
  const cfg = getAiPricingConfig();
  return (inputTokens / 1_000_000) * cfg.inputCostPerMillion
    + (outputTokens / 1_000_000) * cfg.outputCostPerMillion;
}

// 材料解读费用：按解读 token 量计费（与 AI 计费模型一致：成本 ÷ (1-利润率)）
// 即售价 = 解读成本 × 利润率系数（默认 input 1 元/百万 token、利润率 0.8 → 5 元/百万 token）
export function materialFee(tokens) {
  const t = Math.max(0, Number(tokens) || 0);
  if (t <= 0) return 0;
  const cfg = getAiPricingConfig();
  const cost = (t / 1_000_000) * cfg.inputCostPerMillion;
  const price = cost / (1 - cfg.profitMargin);
  return Math.round(price * 100) / 100; // 保留到分
}

// ========== 材料注入 / 计费统一规则（防「计费与注入脱钩」） ==========
// 每份材料注入上限（字符）：生成时仅注入前 20000 字符，控制上下文 token 成本
export const MATERIAL_MAX_CHARS_PER = 20000;
// 单次调用注入总量上限（字符）：超出直接报错（而非静默截断），要求用户精简
export const MATERIAL_TOTAL_CHARS_MAX = 60000;

// 按注入规则折算材料计费 token：每份取前 20000 字符，总量按 60000 封顶
// 计费基数 = 实际注入量（与 tools.loadUserMaterials 的截断规则一致），
// 避免「按材料完整 tokens 计费、却只注入前 20000 字符」的多收费
export function materialBillableTokens(texts) {
  const list = (Array.isArray(texts) ? texts : [])
    .map((t) => String(t || '').slice(0, MATERIAL_MAX_CHARS_PER));
  if (list.length === 0) return 0;
  return estimateTextTokens(list.join('\n\n---\n\n').slice(0, MATERIAL_TOTAL_CHARS_MAX));
}

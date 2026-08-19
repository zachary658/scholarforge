// 现金定价服务（现金直付，非积分）
// 功能定价：固定价格（feature_prices.price，单位元）或人工报价（pricing_mode='quote'）
// 同时保留 token 估算，用于成本监控（不直接扣费）
import { encode } from 'gpt-tokenizer';
import { getFeaturePrice, getAiPricingConfig } from '../config-store.js';

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

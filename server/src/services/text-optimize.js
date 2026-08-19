// 降AI率 / 降重增强（阶段三 3.6）
// - 连贯性启发式检查：严重不通顺自动提示
// - 降AI率：输出 2~3 个版本供用户选择
import { runAI } from '../ai-service.js';
import { rewriteText } from '../ai.js';

// 连贯性启发式检查
export function checkCoherence(text) {
  if (!text || !text.trim()) return { ok: false, issues: ['文本为空'] };
  const issues = [];
  // 超长无标点句子（> 120 字符无句读）视为不通顺
  const sentences = text.split(/[。！？!?；;\n]/).filter((s) => s.trim());
  for (const s of sentences) {
    if (s.length > 120) {
      issues.push('存在超长无标点句子，建议拆分');
      break;
    }
  }
  // 以连接词结尾，可能残缺
  if (/[，,]\s*(因此|然而|但是|此外|而且|故而|所以|综上)$/.test(text.trim())) {
    issues.push('句子以连接词结尾，可能残缺');
  }
  return { ok: issues.length === 0, issues };
}

// 降重：同义词/连接词预替换 → 大模型重组 → 连贯性检查
export async function rewriteEnhanced(text) {
  const synonymPassed = rewriteText({ text }).result;
  const result = await runAI('rewrite', { text: synonymPassed });
  const coherence = checkCoherence(result.content);
  return { content: result.content, model: result.model, tokens: result.tokens, coherence, usedRealAI: result.usedRealAI };
}

// 降AI率：输出 2~3 个版本（专用 prompt 一次调用返回多版本）
export async function aiReduceVersions(text) {
  const result = await runAI('ai_reduce_versions', { text });
  const raw = result.content || '';
  const parts = raw.split(/---VERSION---|----版本----/).map((s) => s.trim()).filter(Boolean);
  const versions = parts.length >= 2 ? parts.slice(0, 3) : (parts.length === 1 ? parts : [raw]);
  const coherence = versions.map((v) => checkCoherence(v));
  return { versions, model: result.model, tokens: result.tokens, coherence, usedRealAI: result.usedRealAI };
}

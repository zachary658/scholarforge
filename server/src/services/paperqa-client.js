// PaperQA2 研究引擎客户端（可选插件）
//
// PaperQA2 是面向科学文献的段落级学术 RAG：全文索引、元数据感知、上下文摘要、
// 重排、引文定位、矛盾检测，支持 PDF/Office/表格/图像和非英语内容（Apache-2.0）。
// 本模块通过独立 Python 服务 research-engine 调用（见 research-engine/），
// 未配置 PAPERQA_API_URL 时整个通道静默跳过，绝不阻断主流程。
//
// 职责边界（方案优先级 5）：只做「研究」——候选论文解析为带页码证据块、逐节检索证据、
// 输出「结论—证据—论文—页码」绑定、检测论文间结论冲突。不接管用户/订单/工作区/前端。
//
// 设计原则：
//   - 所有失败一律 throw，由调用方决定是否降级（与 docling-client / grobid-client 一致）；
//   - 环境变量在调用时读取，便于测试用 env 打桩；
//   - SSRF 防护复用 utils.assertSafeAiResolvedUrl（本服务允许私网部署）。
import { assertSafeAiResolvedUrl } from '../utils.js';
import logger from '../logger.js';

const DEFAULT_TIMEOUT_MS = 60000;

function readConfig() {
  const base = String(process.env.PAPERQA_API_URL || '').trim().replace(/\/+$/, '');
  const apiKey = String(process.env.PAPERQA_API_KEY || '').trim();
  const rawTimeout = Number(process.env.PAPERQA_TIMEOUT_MS);
  const timeout = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_TIMEOUT_MS;
  return { base, apiKey, timeout };
}

// 是否配置了 PaperQA2 研究引擎（未配置时上层直接跳过，不发任何网络请求）
export function isPaperqaConfigured() {
  return Boolean(readConfig().base);
}

async function post(path, body) {
  const { base, apiKey, timeout } = readConfig();
  if (!base) throw new Error('未配置 PAPERQA_API_URL');
  const url = `${base}${path}`;
  await assertSafeAiResolvedUrl(url, { allowPrivate: true });
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-Api-Key'] = apiKey;
  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
    redirect: 'manual',
  });
  if (resp.status >= 300 && resp.status < 400) throw new Error('PaperQA2 响应不允许重定向');
  if (!resp.ok) throw new Error(`PaperQA2 HTTP ${resp.status}`);
  return resp.json();
}

/**
 * 解析文本为带章节的证据块（完整模式走 paper-qa，降级模式走内置分块）。
 * @param {string} text 论文纯文本
 * @param {{ filename?: string, chunkChars?: number, overlapChars?: number }} [options]
 * @returns {Promise<{ blocks: Array, metadata: object, mode: string }>}
 */
export async function parseEvidenceBlocks(text, { filename = 'paper.pdf', chunkChars = 900, overlapChars = 140 } = {}) {
  if (!isPaperqaConfigured()) throw new Error('未配置 PAPERQA_API_URL');
  if (!text) throw new Error('文本内容为空');
  return post('/api/v1/parse', { text, filename, chunk_chars: chunkChars, overlap_chars: overlapChars });
}

/**
 * 逐节证据检索：返回「结论—证据原文—论文—页码」绑定。
 * @param {string} question 研究问题 / 章节标题
 * @param {Array<{text:string,title?:string,page_number?:number}>} documents 候选论文证据块
 * @param {number} [limit]
 * @returns {Promise<{ answer: string, evidence: Array, mode: string }>}
 */
export async function answerWithEvidence(question, documents, limit = 5) {
  if (!isPaperqaConfigured()) throw new Error('未配置 PAPERQA_API_URL');
  if (!question) throw new Error('问题为空');
  return post('/api/v1/answer', { question, documents: documents || [], limit });
}

/**
 * 检测多篇论文结论之间的冲突。
 * @param {Array<{text:string,source_title?:string}>} claims
 * @param {number} [threshold]
 * @returns {Promise<{ conflicts: Array }>}
 */
export async function detectClaimConflicts(claims, threshold = 0.06) {
  if (!isPaperqaConfigured()) throw new Error('未配置 PAPERQA_API_URL');
  return post('/api/v1/conflicts', { claims: claims || [], threshold });
}

/**
 * 健康检查 + 当前运行模式。
 * @returns {Promise<{ status: string, mode: string }>}
 */
export async function paperqaHealth() {
  const { base, apiKey, timeout } = readConfig();
  if (!base) return { status: 'disabled', mode: 'builtin' };
  try {
    await assertSafeAiResolvedUrl(`${base}/api/v1/health`, { allowPrivate: true });
    const headers = apiKey ? { 'X-Api-Key': apiKey } : {};
    const resp = await fetch(`${base}/api/v1/health`, { headers, signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  } catch (err) {
    logger.warn('paperqa-client', `健康检查失败: ${err.message}`);
    return { status: 'error', mode: 'builtin', error: err.message };
  }
}

// Zotero Translation Server 客户端（可选插件）
//
// 通过 Zotero Translation Server（zotero/translation-server，AGPL）把 DOI / PMID /
// ISBN / 网页 / BibTeX / RIS 等导入为结构化文献条目，增强「从外部源导入参考文献」能力。
// 未配置 ZOTERO_TRANSLATION_URL 时整个通道静默跳过，绝不阻断主流程。
//
// 官方契约依据（写代码前已核实）：
//   - 端点：POST /search（单条识别）、POST /web（网页翻译）、POST /import（格式化导入）
//   - 请求：Content-Type: text/plain，body 为 DOI/PMID/ISBN/URL/书目文本
//   - 响应：Zotero 格式的条目数组（JSON）
//   - 详情：https://github.com/zotero/translation-server
//
// 设计原则（与 docling-client / grobid-client / paperqa-client 一致）：
//   - 所有失败一律 throw，由调用方决定是否降级；
//   - 环境变量在调用时读取；
//   - SSRF 防护复用 assertSafeAiResolvedUrl（本服务允许私网部署）。
import { assertSafeAiResolvedUrl } from '../utils.js';

const DEFAULT_TIMEOUT_MS = 30000;

function readConfig() {
  const base = String(process.env.ZOTERO_TRANSLATION_URL || '').trim().replace(/\/+$/, '');
  const rawTimeout = Number(process.env.ZOTERO_TRANSLATION_TIMEOUT_MS);
  const timeout = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_TIMEOUT_MS;
  return { base, timeout };
}

export function isZoteroConfigured() {
  return Boolean(readConfig().base);
}

async function postText(path, body) {
  const { base, timeout } = readConfig();
  if (!base) throw new Error('未配置 ZOTERO_TRANSLATION_URL');
  const url = `${base}${path}`;
  await assertSafeAiResolvedUrl(url, { allowPrivate: true });
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: String(body || ''),
    signal: AbortSignal.timeout(timeout),
    redirect: 'manual',
  });
  if (resp.status >= 300 && resp.status < 400) throw new Error('Zotero 响应不允许重定向');
  if (resp.status === 300) throw new Error('Zotero 返回多个候选项（Multiple Choices）');
  if (!resp.ok) throw new Error(`Zotero HTTP ${resp.status}`);
  return resp.json();
}

// 归一化 Zotero 条目为 ScholarForge 的 reference 结构
function normalizeItem(item) {
  if (!item) return null;
  const creators = Array.isArray(item.creators)
    ? item.creators.map((c) => [c.firstName, c.lastName].filter(Boolean).join(' ')).filter(Boolean)
    : [];
  const title = item.title || '';
  const doi = (item.DOI || '').replace(/^https?:\/\/doi\.org\//i, '');
  return {
    title,
    authors: creators.join(', '),
    year: (item.date || item.issued || '').toString().slice(0, 4),
    journal: item.publicationTitle || item.journalAbbreviation || '',
    doi,
    volume: item.volume || '',
    issue: item.issue || '',
    pages: item.pages || '',
    source_url: item.url || '',
    item_type: item.itemType || '',
    source_db: 'zotero',
  };
}

/**
 * 识别单个标识符（DOI / PMID / ISBN / arXiv / URL）并转为文献条目。
 * @param {string} identifier 如 "10.1000/xyz123"、"PMID:12345678"、"978-..." 或网页 URL
 * @returns {Promise<object>} 归一化的 reference 条目
 */
export async function searchByIdentifier(identifier) {
  if (!identifier) throw new Error('标识符为空');
  const items = await postText('/search', identifier);
  const item = Array.isArray(items) ? items[0] : items;
  const normalized = normalizeItem(item);
  if (!normalized) throw new Error('Zotero 未返回可识别的条目');
  return normalized;
}

/**
 * 批量导入 BibTeX / RIS / CSL-JSON 文本。
 * @param {string} bibliography 书目文本
 * @returns {Promise<object[]>} 归一化的 reference 条目数组
 */
export async function importBibliography(bibliography) {
  if (!bibliography) throw new Error('书目文本为空');
  const items = await postText('/import', bibliography);
  return (Array.isArray(items) ? items : [items]).map(normalizeItem).filter(Boolean);
}

/**
 * 多源文献检索聚合服务
 * 聚合 OpenAlex + Semantic Scholar + CrossRef + arXiv 四个免费学术数据库
 * 统一返回格式，去重合并，按主题相关度、元数据质量与影响力综合排序
 *
 * 设计目标：
 *   - 单一数据源故障不影响整体（降级返回其他源结果）
 *   - 跨源去重（按 DOI/title 归一化）
 *   - 按引用数排序，优先高影响力论文
 *   - 控制返回数量（默认8篇，平衡覆盖度与token成本）
 *   - 熔断机制：连续失败超过阈值后，短时间内不再请求该源
 */
import { DOMParser } from '@xmldom/xmldom';
import logger from '../logger.js';
import { getSetting } from '../config-store.js';
import { searchCnkiViaMCP } from './mcp-literature-source.js';
import { dedupKeyOf } from '../utils.js';

// ===== 检索结果缓存（短 TTL，避免同一 query 重复打外部 API）=====
const SEARCH_CACHE_TTL_MS = 60_000; // 60 秒
const searchCache = new Map(); // cacheKey -> { at, value }

const QUERY_NOISE = /(?:背景下|视角下|研究|探析|浅析|路径分析|应用研究|现状及对策)/g;
const BILINGUAL_TERMS = [
  [/生成式人工智能|生成式AI/gi, 'generative artificial intelligence'],
  [/人工智能/gi, 'artificial intelligence'],
  [/本科教育|高等教育/gi, 'higher education'],
  [/深度学习/gi, 'deep learning'],
  [/医学影像|医学图像/gi, 'medical imaging'],
  [/图像分割/gi, 'image segmentation'],
  [/联邦学习/gi, 'federated learning'],
  [/隐私保护/gi, 'privacy preservation'],
  [/医疗健康/gi, 'healthcare'],
  [/物联网/gi, 'internet of things IoT'],
  [/乡村振兴/gi, 'rural revitalization'],
  [/县域/gi, 'county-level'],
  [/电子商务|电商/gi, 'e-commerce'],
  [/物流/gi, 'logistics'],
  [/风险/gi, 'risks'],
];

export function buildQueryVariants(query, extraVariants = []) {
  const original = String(query || '').replace(/\s+/g, ' ').trim();
  if (!original) return [];
  const simplified = original.replace(QUERY_NOISE, ' ').replace(/\s+/g, ' ').trim();
  const englishTerms = [];
  for (const [pattern, replacement] of BILINGUAL_TERMS) {
    if (pattern.test(original)) englishTerms.push(replacement);
    pattern.lastIndex = 0;
  }
  return [...new Set([
    original,
    simplified !== original ? simplified : '',
    englishTerms.length >= 2 ? englishTerms.join(' ') : '',
    ...extraVariants.map((item) => String(item || '').trim()),
  ].filter(Boolean))].slice(0, 3);
}

async function fetchWithBackoff(url, options = {}, { attempts = 2 } = {}) {
  const { signal: _discardedSignal, timeoutMs = 15000, ...fetchOptions } = options;
  let lastResponse;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let response;
    try {
      response = await fetch(url, { ...fetchOptions, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (attempt + 1 >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
      continue;
    }
    lastResponse = response;
    if (response.ok || (response.status !== 429 && response.status < 500)) return response;
    if (attempt + 1 >= attempts) return response;
    const retryAfter = Number(response.headers.get('retry-after'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 3000)
      : 500 * (2 ** attempt);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return lastResponse;
}

// ===== 熔断器（Circuit Breaker）=====
// 每个源独立计数，连续失败 3 次后熔断 60 秒
const CIRCUIT_BREAK_THRESHOLD = 3;
const CIRCUIT_BREAK_COOLDOWN_MS = 60_000;
const sourceFailures = new Map(); // sourceName -> { failures, lastFailTime, open }

function isCircuitOpen(sourceName) {
  const state = sourceFailures.get(sourceName);
  if (!state || !state.open) return false;
  if (Date.now() - state.lastFailTime > CIRCUIT_BREAK_COOLDOWN_MS) {
    // 冷却期已过，进入半开状态：放行一次探测请求，探测失败则立即重新熔断
    sourceFailures.set(sourceName, { ...state, open: false, halfOpen: true, failures: 0 });
    return false;
  }
  return true;
}

function recordFailure(sourceName) {
  const state = sourceFailures.get(sourceName) || { failures: 0, lastFailTime: 0, open: false, halfOpen: false };
  // 半开探测失败：立即重新熔断（此前重置 failures=0，需再烧 3 次请求才会重新熔断）
  if (state.halfOpen) {
    sourceFailures.set(sourceName, { failures: CIRCUIT_BREAK_THRESHOLD, lastFailTime: Date.now(), open: true, halfOpen: false });
    logger.warn('search', `熔断 ${sourceName}（半开探测失败，立即重新熔断），${CIRCUIT_BREAK_COOLDOWN_MS / 1000}s 后重试`);
    return;
  }
  const newState = {
    failures: state.failures + 1,
    lastFailTime: Date.now(),
    open: state.failures + 1 >= CIRCUIT_BREAK_THRESHOLD,
    halfOpen: false,
  };
  sourceFailures.set(sourceName, newState);
  if (newState.open) {
    logger.warn('search', `熔断 ${sourceName}，连续失败 ${newState.failures} 次，${CIRCUIT_BREAK_COOLDOWN_MS / 1000}s 后重试`);
  }
}

function recordSuccess(sourceName) {
  sourceFailures.set(sourceName, { failures: 0, lastFailTime: 0, open: false, halfOpen: false });
}

// ===== OpenAlex（已有逻辑，提取为独立函数）=====
function getOpenAlexMailto() {
  return getSetting('openalex_mailto', 'scholarforge@test.com') || 'scholarforge@test.com';
}

function decodeInvertedIndex(inv) {
  if (!inv || typeof inv !== 'object') return '';
  const positions = [];
  for (const [word, idxs] of Object.entries(inv)) {
    if (!Array.isArray(idxs)) continue;
    for (const i of idxs) positions.push({ i, word });
  }
  if (positions.length === 0) return '';
  positions.sort((a, b) => a.i - b.i);
  return positions.map((p) => p.word).join(' ');
}

async function searchOpenAlex(query, limit = 8) {
  const mailto = getOpenAlexMailto();
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&mailto=${encodeURIComponent(mailto)}&per-page=${limit}`;
  const resp = await fetchWithBackoff(url, { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`OpenAlex ${resp.status}`);
  const data = await resp.json();
  return (data.results || []).map((work) => {
    const authorships = Array.isArray(work.authorships) ? work.authorships : [];
    const authors = authorships.map((a) => a?.author?.display_name).filter(Boolean).join(', ');
    const source = work.primary_location?.source?.display_name || work.host_venue?.display_name || '';
    let doi = '';
    if (work.doi) doi = work.doi.replace(/^https?:\/\/doi\.org\//i, '');
    const bestOa = work.best_oa_location || {};
    let sourceUrl = '';
    if (doi) sourceUrl = `https://doi.org/${doi}`;
    else if (bestOa.pdf_url) sourceUrl = bestOa.pdf_url;
    else if (bestOa.landing_page_url) sourceUrl = bestOa.landing_page_url;
    else if (work.id) sourceUrl = work.id;
    return {
      title: work.title || '(无标题)',
      authors: authors || '佚名',
      year: work.publication_year ? String(work.publication_year) : '',
      journal: source,
      doi,
      abstract: decodeInvertedIndex(work.abstract_inverted_index),
      cited_by_count: work.cited_by_count || 0,
      source_url: sourceUrl,
      source_db: 'OpenAlex',
      pdf_url: bestOa.pdf_url || '', // 开放获取 PDF 入口（数据套用引擎用）
      is_retracted: Boolean(work.is_retracted),
      _dedupKey: dedupKeyOf(doi || work.title),
    };
  });
}

// ===== Semantic Scholar =====
// 免费 API，2亿篇文献，提供引用关系和摘要
// 文档：https://api.semanticscholar.org/api-docs/graph
async function searchSemanticScholar(query, limit = 8) {
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=title,authors,year,abstract,citationCount,externalIds,journal,openAccessPdf,url`;
  const resp = await fetchWithBackoff(url, {
    headers: { 'User-Agent': 'ScholarForge/1.0 (mailto:scholarforge@test.com)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`SemanticScholar ${resp.status}`);
  const data = await resp.json();
  return (data.data || []).map((p) => {
    const authors = (p.authors || []).map((a) => a.name).filter(Boolean).join(', ');
    const doi = p.externalIds?.DOI || '';
    let sourceUrl = p.url || '';
    if (doi) sourceUrl = `https://doi.org/${doi}`;
    else if (p.openAccessPdf?.url) sourceUrl = p.openAccessPdf.url;
    return {
      title: p.title || '(无标题)',
      authors: authors || '佚名',
      year: p.year ? String(p.year) : '',
      journal: p.journal?.name || '',
      doi,
      abstract: p.abstract || '',
      cited_by_count: p.citationCount || 0,
      source_url: sourceUrl,
      source_db: 'Semantic Scholar',
      pdf_url: p.openAccessPdf?.url || '', // 开放获取 PDF 入口（数据套用引擎用）
      _dedupKey: dedupKeyOf(doi || p.title),
    };
  });
}

// ===== CrossRef =====
// 免费 API，1.5亿DOI，元数据最权威
// 文档：https://api.crossref.org/swagger-ui/index.html
async function searchCrossRef(query, limit = 8) {
  const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${limit}&select=DOI,title,author,published-print,published-online,container-title,abstract,is-referenced-by-count,URL`;
  const resp = await fetchWithBackoff(url, {
    headers: { 'User-Agent': 'ScholarForge/1.0 (mailto:scholarforge@test.com)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`CrossRef ${resp.status}`);
  const data = await resp.json();
  return (data.message.items || []).map((item) => {
    const authors = (item.author || []).map((a) => `${a.given || ''} ${a.family || ''}`.trim()).filter(Boolean).join(', ');
    const year = item['published-print']?.['date-parts']?.[0]?.[0] || item['published-online']?.['date-parts']?.[0]?.[0] || '';
    // CrossRef 的 abstract 是 JATS XML 格式，简单去除标签
    let abstract = item.abstract || '';
    if (abstract) abstract = abstract.replace(/<[^>]+>/g, '').trim();
    const doi = item.DOI || '';
    return {
      title: (item.title || ['(无标题)'])[0],
      authors: authors || '佚名',
      year: year ? String(year) : '',
      journal: (item['container-title'] || [])[0] || '',
      doi,
      abstract,
      cited_by_count: item['is-referenced-by-count'] || 0,
      source_url: item.URL || (doi ? `https://doi.org/${doi}` : ''),
      source_db: 'CrossRef',
      pdf_url: '', // CrossRef 无 OA PDF 直链，由 OpenAlex/Semantic Scholar 补
      _dedupKey: dedupKeyOf(doi || (item.title || [''])[0]),
    };
  });
}

// ===== arXiv =====
// 免费 API，预印本全量覆盖（物理/数学/CS/AI 等理工科），ATOM XML 格式
// 文档：https://info.arxiv.org/help/api/index.html
function arxivTextOf(node, tag) {
  const els = node.getElementsByTagName(tag);
  return els && els.length ? els[0].textContent || '' : '';
}

function cleanArxivText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

// 解析 arXiv ATOM XML 为统一 paper 结构（导出供单元测试使用）
export function parseArxivAtom(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const entries = doc.getElementsByTagName('entry');
  const papers = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const id = arxivTextOf(e, 'id') || '';
    const arxivId = id.split('/abs/').pop() || '';
    // 去重键去掉版本号（v1/v2...）：同一论文不同版本应视为同一篇，且便于与 DOI 键互通去重
    const arxivIdBase = arxivId.replace(/v\d+$/i, '');
    const title = cleanArxivText(arxivTextOf(e, 'title'));
    const summary = cleanArxivText(arxivTextOf(e, 'summary'));
    const published = arxivTextOf(e, 'published') || '';
    const year = published.slice(0, 4);
    const authors = [];
    const authorEls = e.getElementsByTagName('author');
    for (let j = 0; j < authorEls.length; j++) {
      const name = cleanArxivText(arxivTextOf(authorEls[j], 'name'));
      if (name) authors.push(name);
    }
    let pdfUrl = '';
    const links = e.getElementsByTagName('link');
    for (let j = 0; j < links.length; j++) {
      if (links[j].getAttribute && links[j].getAttribute('title') === 'pdf') {
        // arXiv ATOM 返回的 pdf 链接为 http，而下游富集阶段 ^https:// 过滤会剔除 http，
        // 导致 OA 全文提取对主要来源失效；arXiv 完整支持 https，此处归一化为 https
        pdfUrl = (links[j].getAttribute('href') || '').replace(/^http:\/\//i, 'https://');
      }
    }
    papers.push({
      title: title || '(无标题)',
      authors: authors.join(', ') || '佚名',
      year: year || '',
      journal: 'arXiv',
      doi: '',
      abstract: summary,
      cited_by_count: 0, // arXiv API 无引用数
      source_url: arxivId ? `https://arxiv.org/abs/${arxivId}` : '',
      source_db: 'arXiv',
      pdf_url: pdfUrl || (arxivId ? `https://arxiv.org/pdf/${arxivId}` : ''),
      _dedupKey: dedupKeyOf(arxivIdBase || title),
    });
  }
  return papers;
}

async function searchArxiv(query, limit = 8) {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${limit}`;
  const resp = await fetchWithBackoff(url, {
    // arXiv API 强制要求 User-Agent，否则返回 403
    headers: { 'User-Agent': 'ScholarForge/1.0 (mailto:scholarforge@test.com)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`arXiv ${resp.status}`);
  const xmlText = await resp.text();
  return parseArxivAtom(xmlText);
}

// ===== 跨源去重 + 合并排序 =====
function relevanceTokens(value) {
  const raw = String(value || '').normalize('NFKC').toLowerCase();
  const groups = raw.match(/[a-z0-9][a-z0-9._+-]*|[\u3400-\u9fff]+/g) || [];
  const tokens = [];
  for (const group of groups) {
    if (/^[\u3400-\u9fff]+$/.test(group) && group.length > 1) {
      for (let i = 0; i < group.length - 1; i++) tokens.push(group.slice(i, i + 2));
    } else tokens.push(group);
  }
  return [...new Set(tokens)];
}

export function scoreAcademicResult(result, query, currentYear = new Date().getFullYear()) {
  const queryTokens = relevanceTokens(query);
  const titleTokens = new Set(relevanceTokens(result.title));
  const abstractTokens = new Set(relevanceTokens(result.abstract));
  const metadataTokens = new Set(relevanceTokens(`${result.authors || ''} ${result.journal || ''}`));
  const ratio = (set) => queryTokens.length ? queryTokens.filter((token) => set.has(token)).length / queryTokens.length : 0;
  const titleScore = ratio(titleTokens) * 55;
  const abstractScore = ratio(abstractTokens) * 24;
  const metadataScore = ratio(metadataTokens) * 5;
  const citations = Math.min(8, Math.log10(1 + Math.max(0, Number(result.cited_by_count) || 0)) * 2.5);
  const year = Number.parseInt(result.year, 10);
  const recency = Number.isInteger(year) ? Math.max(0, 5 - Math.max(0, currentYear - year) * 0.5) : 0;
  const traceability = result.doi || result.source_url ? 2 : 0;
  const openAccess = result.pdf_url ? 1 : 0;
  return Number((titleScore + abstractScore + metadataScore + citations + recency + traceability + openAccess).toFixed(3));
}

export function rankAcademicResults(results, query) {
  return [...results]
    .map((result) => ({ ...result, relevance_score: scoreAcademicResult(result, query) }))
    .sort((a, b) => b.relevance_score - a.relevance_score || b.cited_by_count - a.cited_by_count);
}

export function titlesLikelySame(left, right) {
  const a = new Set(relevanceTokens(left));
  const b = new Set(relevanceTokens(right));
  if (a.size < 3 || b.size < 3) return false;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / Math.max(a.size, b.size) >= 0.86;
}

function dedupeAndMerge(results, limit = 8, query = '') {
  const seen = new Map();
  for (const r of results) {
    if (r.is_retracted) continue;
    // 归一化去重键保留 Unicode（中文标题此前会被清空成空串导致中文文献被丢弃）
    const key = r._dedupKey || dedupKeyOf(r.title);
    if (!key) continue;
    let matchedKey = seen.has(key) ? key : null;
    if (!matchedKey) {
      for (const [candidateKey, candidate] of seen) {
        const yearGap = Math.abs((Number(candidate.year) || 0) - (Number(r.year) || 0));
        if (yearGap <= 2 && titlesLikelySame(candidate.title, r.title)) {
          matchedKey = candidateKey;
          break;
        }
      }
    }
    if (matchedKey) {
      // 已存在，合并信息（优先保留有摘要的、引用数高的）
      const existing = seen.get(matchedKey);
      if (existing.source_db === 'arXiv' && r.source_db !== 'arXiv') {
        seen.set(matchedKey, {
          ...r,
          abstract: r.abstract || existing.abstract,
          pdf_url: r.pdf_url || existing.pdf_url,
          all_sources: [...new Set([...(existing.all_sources || ['arXiv']), r.source_db])],
        });
        continue;
      }
      if (!existing.abstract && r.abstract) existing.abstract = r.abstract;
      if (!existing.pdf_url && r.pdf_url) existing.pdf_url = r.pdf_url;
      if (r.cited_by_count > existing.cited_by_count) existing.cited_by_count = r.cited_by_count;
      // 记录所有来源
      if (!existing.all_sources) existing.all_sources = [existing.source_db];
      if (!existing.all_sources.includes(r.source_db)) existing.all_sources.push(r.source_db);
    } else {
      seen.set(key, { ...r, all_sources: [r.source_db] });
    }
  }
  // 相关性为主，引用量仅作为影响力信号之一；避免“高引用但偏题”的论文占据前排。
  return rankAcademicResults([...seen.values()], query)
    .slice(0, limit)
    .map(({ _dedupKey, ...rest }) => rest);
}

// ===== 统一检索入口 =====
/**
 * 多源聚合检索
 * @param {string} query 检索词（题目/关键词）
 * @param {object} opts { limit, sources }
 * @returns {Promise<{results: Array, sources_used: string[], errors: string[]}>}
 */
async function searchSingleQuery(query, opts = {}) {
  const limit = opts.limit || 8;
  const sources = opts.sources || ['openalex', 'semantic', 'crossref', 'arxiv', 'cnki'];
  // 短 TTL 缓存：同一 query 在 60s 内复用结果，避免重复打外部 API
  const cacheKey = `${(query || '').trim().toLowerCase()}|${limit}|${[...sources].sort().join(',')}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL_MS) {
    return cached.value;
  }
  const errors = [];
  const sources_used = [];
  const allResults = [];

  // 并行检索（任一失败不影响其他；熔断器短路已熔断的源）
  const tasks = [];
  if (sources.includes('openalex')) {
    if (isCircuitOpen('OpenAlex')) {
      errors.push('OpenAlex: 熔断中（连续失败过多，暂时跳过）');
    } else {
      tasks.push(
        searchOpenAlex(query, limit)
          .then((r) => { recordSuccess('OpenAlex'); sources_used.push('OpenAlex'); allResults.push(...r); })
          .catch((e) => { recordFailure('OpenAlex'); errors.push(`OpenAlex: ${e.message}`); })
      );
    }
  }
  if (sources.includes('semantic')) {
    if (isCircuitOpen('Semantic Scholar')) {
      errors.push('Semantic Scholar: 熔断中（连续失败过多，暂时跳过）');
    } else {
      tasks.push(
        searchSemanticScholar(query, limit)
          .then((r) => { recordSuccess('Semantic Scholar'); sources_used.push('Semantic Scholar'); allResults.push(...r); })
          .catch((e) => { recordFailure('Semantic Scholar'); errors.push(`Semantic Scholar: ${e.message}`); })
      );
    }
  }
  if (sources.includes('crossref')) {
    if (isCircuitOpen('CrossRef')) {
      errors.push('CrossRef: 熔断中（连续失败过多，暂时跳过）');
    } else {
      tasks.push(
        searchCrossRef(query, limit)
          .then((r) => { recordSuccess('CrossRef'); sources_used.push('CrossRef'); allResults.push(...r); })
          .catch((e) => { recordFailure('CrossRef'); errors.push(`CrossRef: ${e.message}`); })
      );
    }
  }
  if (sources.includes('arxiv')) {
    if (isCircuitOpen('arXiv')) {
      errors.push('arXiv: 熔断中（连续失败过多，暂时跳过）');
    } else {
      tasks.push(
        searchArxiv(query, limit)
          .then((r) => { recordSuccess('arXiv'); sources_used.push('arXiv'); allResults.push(...r); })
          .catch((e) => { recordFailure('arXiv'); errors.push(`arXiv: ${e.message}`); })
      );
    }
  }
  // CNKI（知网）通道：可选 MCP 插件（CNKI_MCP_COMMAND 配置后启用），未配置时静默跳过
  if (sources.includes('cnki')) {
    tasks.push(
      searchCnkiViaMCP(query, limit).then((r) => {
        if (r.disabled) return; // 未配置，静默跳过
        if (r.circuitOpen) { errors.push('CNKI: 熔断中（连续失败过多，暂时跳过）'); return; }
        if (r.papers && r.papers.length > 0) {
          sources_used.push('CNKI');
          allResults.push(...r.papers);
        } else if (r.error) {
          errors.push(`CNKI: ${r.error}`);
        }
      })
    );
  }
  await Promise.all(tasks);

  // 去重合并
  const results = dedupeAndMerge(allResults, limit, query);
  const result = { results, sources_used, errors };
  // 写入缓存前顺带清理过期条目，防 Map 无界增长
  const nowMs = Date.now();
  for (const [k, v] of searchCache) {
    if (nowMs - v.at > SEARCH_CACHE_TTL_MS) searchCache.delete(k);
  }
  searchCache.set(cacheKey, { at: nowMs, value: result });
  return result;
}

function titleAgreement(expected, actual) {
  const expectedTokens = relevanceTokens(expected);
  const actualTokens = new Set(relevanceTokens(actual));
  if (expectedTokens.length === 0) return false;
  return expectedTokens.filter((token) => actualTokens.has(token)).length / expectedTokens.length >= 0.65;
}

export async function verifyReferenceDois(references, { limit = 8 } = {}) {
  const items = Array.isArray(references) ? references : [];
  return Promise.all(items.map(async (reference, index) => {
    if (!reference?.doi || index >= limit) return { ...reference, doi_verified: null };
    try {
      const url = `https://api.crossref.org/works/${encodeURIComponent(reference.doi)}`;
      const response = await fetchWithBackoff(url, {
        headers: { 'User-Agent': 'ScholarForge/1.0 (mailto:scholarforge@test.com)' },
        timeoutMs: 6000,
      });
      if (response.status === 404) return { ...reference, doi_verified: false, verification_error: 'DOI_NOT_FOUND' };
      if (!response.ok) return { ...reference, doi_verified: null, verification_error: `CrossRef ${response.status}` };
      const payload = await response.json();
      const verifiedTitle = payload?.message?.title?.[0] || '';
      const matches = titleAgreement(reference.title, verifiedTitle);
      return {
        ...reference,
        doi_verified: matches,
        verification_error: matches ? '' : 'DOI_TITLE_MISMATCH',
      };
    } catch (error) {
      return { ...reference, doi_verified: null, verification_error: error.message || 'VERIFY_FAILED' };
    }
  }));
}

export async function searchMultiSource(query, opts = {}) {
  const limit = opts.limit || 8;
  const variants = buildQueryVariants(query, opts.queryVariants || []);
  if (variants.length === 0) return { results: [], sources_used: [], errors: [], diagnostics: { variants: [] } };

  const first = await searchSingleQuery(variants[0], opts);
  let combined = [...first.results];
  const sources = new Set(first.sources_used);
  const errors = new Set(first.errors);
  const firstTopScore = Number(first.results[0]?.relevance_score || 0);
  const containsChinese = /[\u3400-\u9fff]/.test(variants[0]);
  const needsExpansion = first.results.length < Math.min(limit, 5)
    || firstTopScore < 20
    || (containsChinese && variants.length > 1 && firstTopScore < 45);
  const usedVariants = [variants[0]];

  if (needsExpansion) {
    for (const variant of variants.slice(1)) {
      const next = await searchSingleQuery(variant, { ...opts, limit: Math.max(limit, 8) });
      combined.push(...next.results);
      next.sources_used.forEach((source) => sources.add(source));
      next.errors.forEach((error) => errors.add(error));
      usedVariants.push(variant);
    }
  }

  // 查询扩展产生的英文结果按其命中的最佳变体计分，避免被中文原句的字符重合规则压低。
  const ranked = dedupeAndMerge(combined, Math.max(combined.length, limit), variants[0])
    .map((paper) => ({
      ...paper,
      relevance_score: Math.max(...usedVariants.map((variant) => scoreAcademicResult(paper, variant))),
    }))
    .sort((a, b) => b.relevance_score - a.relevance_score || b.cited_by_count - a.cited_by_count);
  const relevant = ranked.filter((paper) => paper.relevance_score >= 10).slice(0, limit);
  const results = relevant.length >= Math.min(3, limit) ? relevant : ranked.slice(0, limit);
  const traceable = results.filter((paper) => paper.doi || paper.source_url).length;
  logger.info('search-metrics', JSON.stringify({
    query: variants[0].slice(0, 120), variants: usedVariants.length,
    candidates: combined.length, returned: results.length, traceable,
    sources: sources.size, errors: errors.size,
    lowRelevanceFallback: relevant.length < Math.min(3, limit),
  }));
  return {
    results,
    sources_used: [...sources],
    errors: [...errors],
    diagnostics: {
      variants: usedVariants,
      expanded: usedVariants.length > 1,
      candidates: combined.length,
      returned: results.length,
      traceable,
      low_relevance_fallback: relevant.length < Math.min(3, limit),
    },
  };
}

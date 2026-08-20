/**
 * 多源文献检索聚合服务
 * 聚合 OpenAlex + Semantic Scholar + CrossRef + arXiv 四个免费学术数据库
 * 统一返回格式，去重合并，按引用数排序
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

// ===== 检索结果缓存（短 TTL，避免同一 query 重复打外部 API）=====
const SEARCH_CACHE_TTL_MS = 60_000; // 60 秒
const searchCache = new Map(); // cacheKey -> { at, value }

// ===== 熔断器（Circuit Breaker）=====
// 每个源独立计数，连续失败 3 次后熔断 60 秒
const CIRCUIT_BREAK_THRESHOLD = 3;
const CIRCUIT_BREAK_COOLDOWN_MS = 60_000;
const sourceFailures = new Map(); // sourceName -> { failures, lastFailTime, open }

function isCircuitOpen(sourceName) {
  const state = sourceFailures.get(sourceName);
  if (!state || !state.open) return false;
  if (Date.now() - state.lastFailTime > CIRCUIT_BREAK_COOLDOWN_MS) {
    // 冷却期已过，半开状态（允许重试）
    sourceFailures.set(sourceName, { ...state, open: false, failures: 0 });
    return false;
  }
  return true;
}

function recordFailure(sourceName) {
  const state = sourceFailures.get(sourceName) || { failures: 0, lastFailTime: 0, open: false };
  const newState = {
    failures: state.failures + 1,
    lastFailTime: Date.now(),
    open: state.failures + 1 >= CIRCUIT_BREAK_THRESHOLD,
  };
  sourceFailures.set(sourceName, newState);
  if (newState.open) {
    logger.warn('search', `熔断 ${sourceName}，连续失败 ${newState.failures} 次，${CIRCUIT_BREAK_COOLDOWN_MS / 1000}s 后重试`);
  }
}

function recordSuccess(sourceName) {
  sourceFailures.set(sourceName, { failures: 0, lastFailTime: 0, open: false });
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
  const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
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
      _dedupKey: (doi || work.title || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
    };
  });
}

// ===== Semantic Scholar =====
// 免费 API，2亿篇文献，提供引用关系和摘要
// 文档：https://api.semanticscholar.org/api-docs/graph
async function searchSemanticScholar(query, limit = 8) {
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=title,authors,year,abstract,citationCount,externalIds,journal,openAccessPdf,url`;
  const resp = await fetch(url, {
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
      _dedupKey: (doi || p.title || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
    };
  });
}

// ===== CrossRef =====
// 免费 API，1.5亿DOI，元数据最权威
// 文档：https://api.crossref.org/swagger-ui/index.html
async function searchCrossRef(query, limit = 8) {
  const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${limit}&select=DOI,title,author,published-print,published-online,container-title,abstract,is-referenced-by-count,URL`;
  const resp = await fetch(url, {
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
      _dedupKey: (doi || (item.title || [''])[0] || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
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
        pdfUrl = links[j].getAttribute('href') || '';
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
      _dedupKey: (arxivId || title || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
    });
  }
  return papers;
}

async function searchArxiv(query, limit = 8) {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${limit}`;
  const resp = await fetch(url, {
    // arXiv API 强制要求 User-Agent，否则返回 403
    headers: { 'User-Agent': 'ScholarForge/1.0 (mailto:scholarforge@test.com)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`arXiv ${resp.status}`);
  const xmlText = await resp.text();
  return parseArxivAtom(xmlText);
}

// ===== 跨源去重 + 合并排序 =====
function dedupeAndMerge(results, limit = 8) {
  const seen = new Map();
  for (const r of results) {
    const key = r._dedupKey;
    if (!key) continue;
    if (seen.has(key)) {
      // 已存在，合并信息（优先保留有摘要的、引用数高的）
      const existing = seen.get(key);
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
  // 按引用数降序排序，取 top N
  return [...seen.values()]
    .sort((a, b) => b.cited_by_count - a.cited_by_count)
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
export async function searchMultiSource(query, opts = {}) {
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
  const results = dedupeAndMerge(allResults, limit);
  const result = { results, sources_used, errors };
  // 写入缓存前顺带清理过期条目，防 Map 无界增长
  const nowMs = Date.now();
  for (const [k, v] of searchCache) {
    if (nowMs - v.at > SEARCH_CACHE_TTL_MS) searchCache.delete(k);
  }
  searchCache.set(cacheKey, { at: nowMs, value: result });
  return result;
}

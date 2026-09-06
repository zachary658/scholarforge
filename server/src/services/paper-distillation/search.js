/**
 * 多源检索与文献核验：
 *   - 共享检索：多源聚合检索 + 构建真实文献/benchmark（供智能写作与普通写作复用）
 *   - 文献核验白名单：只有来自受控学术数据源、且具备可回查入口的记录才能进入正文
 *   - 跨视角去重合并：按 _dedupKey/title 归一，优先保留有摘要、引用数高、有 PDF 的记录
 * 从 paper-distillation.js 拆出。
 */
import { searchMultiSource } from '../multi-source-search.js';
import { hasReferenceProof } from '../reference-proof.js';
import { dedupKeyOf } from '../../utils.js';
import { extractBenchmarkData } from './data-extraction.js';

// ===== 共享检索：多源检索 + 构建真实文献/benchmark（供智能写作与普通写作复用）=====
/**
 * 执行多源检索，并构建真实参考文献列表与真实 benchmark 数据。
 * @returns {Promise<{papers, references, benchmarks, sources_used, errors}>}
 */
export async function collectWritingSources(topic, field, keywords = '', limit = 8) {
  const query = [topic, field, keywords].filter(Boolean).join(' ');
  const { results: papers, sources_used, errors } = await searchMultiSource(query, { limit });
  const references = papers.slice(0, limit).map((p) => ({
    title: p.title,
    authors: p.authors,
    year: p.year,
    journal: p.journal,
    doi: p.doi,
    abstract: p.abstract || '',
    source_url: p.source_url,
    source_db: p.source_db,
    cited_by_count: p.cited_by_count,
  }));
  const benchmarks = extractBenchmarkData(papers);
  return { papers, references, benchmarks, sources_used, errors };
}

// 只有来自受控学术数据源、且具备可回查入口的记录才能进入正文。
// DOI 明确核验失败的记录必须剔除；没有 DOI 时仍须保留上游数据库详情页。
export function isVerifiedWritingReference(ref) {
  if (!ref?.title || ref.doi_verified === false) return false;
  const source = String(ref.source_db || '').toLowerCase();
  const trustedSource = ['openalex', 'semantic scholar', 'crossref', 'arxiv'].some((name) => source.includes(name));
  const traceable = Boolean(ref.doi || /^https?:\/\//i.test(String(ref.source_url || '')));
  return (trustedSource || hasReferenceProof(ref)) && traceable;
}

export function filterVerifiedWritingReferences(references) {
  return (Array.isArray(references) ? references : []).filter(isVerifiedWritingReference);
}

// 跨视角去重合并：按 _dedupKey/title 归一，优先保留有摘要、引用数高、有 PDF 的记录
export function dedupePapers(papers) {
  const seen = new Map();
  for (const p of papers) {
    // 归一化保留 Unicode：中文标题此前被清空成空串导致中文文献被整体丢弃
    const key = p._dedupKey || dedupKeyOf(p.title);
    if (!key) continue;
    if (seen.has(key)) {
      const ex = seen.get(key);
      if (!ex.abstract && p.abstract) ex.abstract = p.abstract;
      if (p.cited_by_count > ex.cited_by_count) ex.cited_by_count = p.cited_by_count;
      if (!ex.pdf_url && p.pdf_url) ex.pdf_url = p.pdf_url;
    } else {
      seen.set(key, { ...p });
    }
  }
  return [...seen.values()].sort((a, b) => b.cited_by_count - a.cited_by_count);
}

import { searchMultiSource } from './multi-source-search.js';
import { attestReference, hasReferenceProof } from './reference-proof.js';

const normalize = text => String(text || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
const doi = text => String(text || '').replace(/^https?:\/\/(?:dx\.)?doi.org\//i, '').trim().toLowerCase();

export async function resolveWritingReferences(candidates) {
  if (!Array.isArray(candidates) || candidates.length > 30) throw new Error('每次请确认不超过 30 篇文献');
  const verified = [];
  const rejected = [];
  const seen = new Set();
  // Batches bound upstream concurrency, including queries for manually entered records.
  for (let i = 0; i < candidates.length; i += 3) {
    const batch = await Promise.all(candidates.slice(i, i + 3).map(async ref => {
      if (!ref?.title || String(ref.title).length > 500) return null;
      if (hasReferenceProof(ref)) return ref;
      const result = await searchMultiSource(ref.title, { limit: 8 });
      const canonical = result.results.find(r => normalize(r.title) === normalize(ref.title)
        && (!ref.doi || doi(r.doi) === doi(ref.doi)) && r.doi_verified !== false && (r.doi || r.source_url));
      return canonical ? attestReference(canonical) : null;
    }));
    batch.forEach((ref, j) => {
      if (!ref) { rejected.push(candidates[i + j]?.title || '未命名文献'); return; }
      const key = doi(ref.doi) || normalize(ref.title);
      if (!seen.has(key)) { verified.push(ref); seen.add(key); }
    });
  }
  if (rejected.length) throw new Error(`以下文献尚未匹配到学术数据源，请核对标题/DOI或重新检索：${rejected.join('；')}`);
  return verified;
}

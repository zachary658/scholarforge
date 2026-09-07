import { searchMultiSource } from './multi-source-search.js';
import { attestReference, hasReferenceProof } from './reference-proof.js';

const normalize = (value) => String(value || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
const normalizeDoi = (value) => String(value || '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').trim().toLowerCase();

export function isForeignReference(reference) {
  const language = String(reference?.language || reference?.lang || '').toLowerCase();
  if (/^(en|eng|english)(?:[-_]|$)/.test(language)) return true;
  if (/^(zh|zho|chi|chinese)(?:[-_]|$)/.test(language)) return false;
  const title = String(reference?.title || '');
  const latin = (title.match(/[A-Za-z]/g) || []).length;
  const han = (title.match(/[\u3400-\u9fff]/g) || []).length;
  return latin >= 8 && latin > han * 2;
}

function keyOf(reference) {
  return normalizeDoi(reference?.doi) || normalize(reference?.title);
}

function isTraceable(reference) {
  return Boolean(reference?.doi || /^https?:\/\//i.test(reference?.source_url || reference?.url || ''));
}

export async function supplementVerifiedReferences(project, {
  minTotal = 10,
  minForeign = 3,
  searcher = searchMultiSource,
} = {}) {
  const existing = Array.isArray(project?.sources?.references) ? project.sources.references : [];
  const selected = existing.filter(hasReferenceProof);
  const seen = new Set(selected.map(keyOf).filter(Boolean));
  const candidates = [];
  const errors = [];
  const queries = [
    [project?.title, project?.field].filter(Boolean).join(' '),
    [project?.title, project?.description].filter(Boolean).join(' '),
  ].map((item) => item.replace(/\s+/g, ' ').trim()).filter(Boolean);

  for (const query of [...new Set(queries)]) {
    if (selected.length + candidates.length >= minTotal
      && [...selected, ...candidates].filter(isForeignReference).length >= minForeign) break;
    let result;
    try {
      result = await searcher(query, { limit: 20 });
    } catch (error) {
      errors.push(error.message || '学术数据源请求失败');
      continue;
    }
    for (const reference of result?.results || []) {
      const key = keyOf(reference);
      if (!key || seen.has(key) || !isTraceable(reference) || reference.is_retracted) continue;
      seen.add(key);
      candidates.push(attestReference({
        ...reference,
        source_verified: true,
        verification_source: reference.source_db || 'academic-search',
      }));
    }
  }

  const combined = [...selected];
  const foreignNeeded = Math.max(0, minForeign - combined.filter(isForeignReference).length);
  const foreignCandidates = candidates.filter(isForeignReference);
  combined.push(...foreignCandidates.slice(0, foreignNeeded));
  for (const reference of candidates) {
    if (combined.length >= minTotal && combined.filter(isForeignReference).length >= minForeign) break;
    if (!combined.some((item) => keyOf(item) === keyOf(reference))) combined.push(reference);
  }

  return {
    references: combined,
    added: combined.length - selected.length,
    total: combined.length,
    foreign: combined.filter(isForeignReference).length,
    complete: combined.length >= minTotal && combined.filter(isForeignReference).length >= minForeign,
    errors,
  };
}

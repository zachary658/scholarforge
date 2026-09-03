// Pure quality rules shared by routes and tests.

export function classifyReferenceSearch({ results = [], sources_used = [], errors = [] } = {}) {
  if (sources_used.length === 0 && errors.length > 0) return 'unavailable';
  if (results.length === 0) return 'empty';
  if (errors.length > 0) return 'partial';
  return 'ok';
}

export function shouldCacheReferenceSearch(health) {
  return health === 'ok' || health === 'empty';
}

export function assessResearchDelivery(result, { minReferences = 3, minCoreSections = 2 } = {}) {
  const framework = result?.framework || {};
  const references = Array.isArray(result?.references) ? result.references : [];
  const traceableReferences = references.filter((ref) => ref && (ref.doi || ref.source_url));
  const coreSections = ['methods', 'innovations', 'conclusions']
    .filter((key) => Array.isArray(framework[key]) && framework[key].length > 0);
  const paperCount = Number(framework.paperCount || 0);
  const reasons = [];
  if (traceableReferences.length < minReferences) reasons.push(`可溯源文献少于 ${minReferences} 篇`);
  if (paperCount < minReferences) reasons.push(`有效论文数少于 ${minReferences} 篇`);
  if (coreSections.length < minCoreSections) reasons.push(`研究框架核心部分少于 ${minCoreSections} 类`);
  return {
    ok: reasons.length === 0,
    reasons,
    traceableReferenceCount: traceableReferences.length,
    coreSectionCount: coreSections.length,
    paperCount,
  };
}

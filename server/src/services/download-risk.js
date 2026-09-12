export const RISK_NOTICE = '本工具生成内容仅供参考，实际提交前请自行通过学校指定渠道查重，本平台不对最终查重或答辩结果负责。以下等级仅粗估文内段落重复，不代表外部文献重复率或学校检测结果。';

export function requiresDownloadAcknowledgment(doc) {
  return ['writing_fulltext', 'chapters'].includes(doc.feature);
}

// Linear work with bounded input; repeated grams within one paragraph are counted once.
export function estimateDownloadRisk(content) {
  if (String(content || '').length > 1000000) return { level: 'unknown', method: 'input-limit-exceeded', paragraphCount: null };
  const paragraphs = String(content || '').slice(0, 1000000).split(/\n+/)
    .map(p => p.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()).filter(p => p.length >= 20);
  const seen = new Set();
  let total = 0;
  let repeated = 0;
  for (const paragraph of paragraphs) {
    const grams = new Set();
    for (let i = 0; i <= paragraph.length - 5; i++) grams.add(paragraph.slice(i, i + 5));
    for (const gram of grams) { total++; if (seen.has(gram)) repeated++; }
    for (const gram of grams) seen.add(gram);
  }
  const overlap = total ? repeated / total : 0;
  return { level: paragraphs.length < 2 ? 'unknown' : overlap >= 0.3 ? 'high' : overlap >= 0.1 ? 'medium' : 'low', overlap: Math.round(overlap * 10000) / 10000, method: 'internal-paragraph-5gram-v1', paragraphCount: paragraphs.length };
}

export function downloadRisk(doc) {
  let risk;
  try { risk = JSON.parse(doc.download_risk || 'null'); } catch { /* legacy artifact */ }
  return { required: requiresDownloadAcknowledgment(doc), risk: risk || { level: 'unknown', method: 'unavailable' }, notice: RISK_NOTICE, acknowledgedAt: doc.risk_acknowledged_at || null };
}

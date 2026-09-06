/**
 * 引用格式化（引用与数据完整性：由代码强制生成，模型只负责语言组织）：
 *   - GB/T 7714 手写版参考文献列表
 *   - CSL 官方样式版（GB/T 7714-2015，失败自动回退手写版）
 *   - [CITE:n] 占位符替换与文末参考文献列表追加
 * 从 paper-distillation.js 拆出。
 */
import { filterVerifiedWritingReferences } from './search.js';

// GB/T 7714 格式化参考文献列表
export function formatReferencesGB(references) {
  if (!Array.isArray(references) || references.length === 0) return '';
  return references.map((r, i) => {
    const authors = (r.authors || '佚名').replace(/\.\s*$/, '');
    const title = (r.title || '').trim();
    const journal = (r.journal || '').trim();
    const year = String(r.year || '').trim();
    const doi = (r.doi || '').trim();
    let line = `[${i + 1}] ${authors}. ${title}`;
    if (journal) line += `[J]. ${journal}`;
    if (year) line += (journal ? ', ' : '. ') + year;
    if (doi) line += `. DOI: ${doi}`;
    return line.endsWith('.') ? line : line + '.';
  }).join('\n');
}

// 替换引用占位符 [CITE:n] → [n]；appendReferences=true 时在文末追加参考文献列表
// 分章节生成时传 appendReferences=false（参考文献只在合并全文/全文生成时追加一次，
// 否则每一章结尾都会重复出现整份参考文献列表）
export function replaceCitePlaceholders(content, references, { appendReferences = true } = {}) {
  if (!content) return content;
  const safeReferences = filterVerifiedWritingReferences(references);
  const hasRefs = safeReferences.length > 0;
  let replaced = String(content)
    // 模型无权撰写文献元数据。删除它自行生成的文末列表，稍后由代码从白名单重建。
    .replace(/\n#{0,3}\s*(?:(?:主要)?参考文献|References)\s*\n[\s\S]*$/i, '')
    .replace(/\[CITE:(\d+)\]/g, (_m, n) => {
    const idx = parseInt(n, 10);
    if (!hasRefs || idx < 1 || idx > safeReferences.length) return '';
    return `[${idx}]`;
  });
  if (appendReferences && hasRefs) {
    replaced = `${replaced.trim()}\n\n## 参考文献\n\n${formatReferencesGB(safeReferences)}`;
  }
  return replaced;
}

// 引用占位符替换（CSL 官方样式版）：先复用同步替换逻辑处理 [CITE:n]，
// 再用官方 GB/T 7714-2015 样式引擎追加参考文献列表；CSL 不可用/渲染失败时
// 自动回退到 formatReferencesGB 手写版，绝不阻断导出流程。
// 仅在全文本/全文生成路径（appendReferences=true）需要调用；分章节场景仍用同步版。
export async function replaceCitePlaceholdersCsl(content, references, { appendReferences = true } = {}) {
  if (!content) return content;
  const safeReferences = filterVerifiedWritingReferences(references);
  const hasRefs = safeReferences.length > 0;
  // 占位符替换与同步版完全一致（纯字符串处理，无依赖）
  let replaced = String(content)
    .replace(/\n#{0,3}\s*(?:(?:主要)?参考文献|References)\s*\n[\s\S]*$/i, '')
    .replace(/\[CITE:(\d+)\]/g, (_m, n) => {
    const idx = parseInt(n, 10);
    if (!hasRefs || idx < 1 || idx > safeReferences.length) return '';
    return `[${idx}]`;
  });
  if (appendReferences && hasRefs) {
    let refText = '';
    try {
      const { formatReferencesGBWithCsl, isCslAvailable } = await import('../csl-formatter.js');
      if (isCslAvailable()) {
        refText = await formatReferencesGBWithCsl(safeReferences);
      }
    } catch (err) {
      // CSL 引擎失败：静默回退手写版
    }
    if (!refText) refText = formatReferencesGB(safeReferences);
    replaced = `${replaced.trim()}\n\n## 参考文献\n\n${refText}`;
  }
  return replaced;
}

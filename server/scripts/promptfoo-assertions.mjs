// ----------------------------------------------------------------------------
// Promptfoo 自定义断言集（ScholarForge 生成质量 8 个维度）
// ----------------------------------------------------------------------------
// 契约（已核实 promptfoo 0.100.6 源码 dist/src/assertions/index.js）：
//   1. javascript 断言的 file:// 值只支持「整个文件」，不支持 file://x.mjs:fn 冒号语法——
//      promptfoo 会用 path.extname 判断文件类型，带上 :fn 后缀后会被当成非 JS 文件，
//      最终走到 processFileReference 抛 ENOENT（实测确认）。
//      因此本文件的默认导出是一个「调度函数」，由用例通过 config.fn 指定要执行的断言：
//          assert:
//            - type: javascript
//              value: file://scripts/promptfoo-assertions.mjs
//              config:
//                fn: assertCitationsExist
//   2. 函数签名 (output, context) => boolean | number | { pass, score, reason, componentResults }；
//      async 函数受支持；
//   3. context.vars 为用例变量，context.config 为该断言实例的配置（同一断言可带不同阈值复用）；
//   4. file:// 路径相对 promptfooconfig.yaml 所在目录（即 server/）解析。
//
// 设计原则：
//   - 每个断言都是可单独 import 的纯函数，node:test 可直接单测，不依赖 promptfoo 运行时；
//   - 全部离线确定性：不联网、不依赖真实 AI Key；
//   - 每个断言都返回 score（0~1）而非只有 pass，便于做「换模型/改 Prompt 后质量是变好还是变差」的对比；
//   - 反例用例（fixture 里预置编造引用/编造数据/缺章）必须能判 fail，否则断言就是摆设。
// ----------------------------------------------------------------------------

const CJK_RANGE = '\\u3400-\\u9fff';
const TOKEN_RE = new RegExp(`[a-z0-9][a-z0-9._+-]*|[${CJK_RANGE}]+`, 'g');
const CJK_TOKEN_RE = new RegExp(`^[${CJK_RANGE}]+$`);

// 默认阈值集中在此，便于按学科/工具整体校准
export const DEFAULT_THRESHOLDS = {
  evidenceCoverage: 0.6,   // 可溯源段落占比下限
  citationSimilarity: 0.05, // 单条引文与所引文献的 Jaccard 下限
  citationSupportRatio: 0.6, // 支持论点的引文占比下限
  sectionDuplicate: 0.7,   // 章节间重复判定阈值
  contradictionSimilarity: 0.06, // 互斥表述所在句的相似度下限
  stability: 0.6,          // 稳定性综合分下限
};

// ===== 通用工具（导出以便单测直接覆盖） =====

// promptfoo 传入的 output 可能是字符串，也可能是被解析器还原过的对象
export function toText(output) {
  if (output == null) return '';
  if (typeof output === 'string') return output;
  if (typeof output === 'object') {
    if (typeof output.output === 'string') return output.output;
    try {
      return JSON.stringify(output);
    } catch {
      return String(output);
    }
  }
  return String(output);
}

// vars 里的结构化字段既可能是 JSON 字符串（YAML 内联），也可能已被 promptfoo 解析成对象
export function parseVarValue(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// 中英文二元词组切分：中文按 2-gram 滑窗，英文/数字按词切分。
// 思路参考 src/services/evidence-engine.js 的 tokenizeEvidence，但此处实现为纯函数，
// 不 import 业务模块，避免断言脚本反向依赖检索管线（也避免拉起数据库）。
export function tokenizeText(value) {
  const text = String(value ?? '').toLowerCase();
  const tokens = text.match(TOKEN_RE) || [];
  const out = [];
  for (const token of tokens) {
    if (CJK_TOKEN_RE.test(token)) {
      if (token.length === 1) out.push(token);
      else for (let i = 0; i < token.length - 1; i += 1) out.push(token.slice(i, i + 2));
    } else {
      out.push(token);
    }
  }
  return out;
}

// 集合 Jaccard 相似度
export function jaccardSimilarity(a, b) {
  const setA = a instanceof Set ? a : new Set(a);
  const setB = b instanceof Set ? b : new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) if (setB.has(item)) intersection += 1;
  return intersection / (setA.size + setB.size - intersection);
}

// 句子切分（中英文句末标点 + 分号 + 换行）
export function splitSentences(text) {
  return String(text || '')
    .split(/[。！？；!?;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// 段落切分：跳过代码围栏（图表/公式不是声明性段落）
export function splitParagraphs(text) {
  const blocks = [];
  let buffer = [];
  let inFence = false;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine;
    if (/^\s*(```|~~~)/.test(line)) {
      if (buffer.length) blocks.push(buffer.join('\n'));
      buffer = [];
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line.trim() === '') {
      if (buffer.length) blocks.push(buffer.join('\n'));
      buffer = [];
      continue;
    }
    buffer.push(line);
  }
  if (buffer.length) blocks.push(buffer.join('\n'));
  return blocks.map((b) => b.trim()).filter(Boolean);
}

const BIB_HEADING_RE = /^[ \t]{0,3}#{1,6}\s*(?:参考文献|参考资料|References|Bibliography)\s*$/im;

// 取正文（去掉文末参考文献列表）。
// 必要性：参考文献条目里天然带 [1][2] 编号，若不剔除，引用类断言会把文献表本身
// 当成正文引用，导致「编造引用」永远查不出来。
export function stripBibliography(text) {
  const source = String(text || '');
  const m = BIB_HEADING_RE.exec(source);
  if (m) return source.slice(0, m.index);
  const fallback = source.search(/^[ \t]*\[1\][ \t]+\S+/m);
  return fallback > 0 ? source.slice(0, fallback) : source;
}

export function extractBibliography(text) {
  const source = String(text || '');
  const m = BIB_HEADING_RE.exec(source);
  if (m) return source.slice(m.index + m[0].length);
  const fallback = source.search(/^[ \t]*\[1\][ \t]+\S+/m);
  return fallback > 0 ? source.slice(fallback) : '';
}

// 抽取 Markdown 标题序列
export function extractHeadings(text) {
  return [...String(text || '').matchAll(/^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)]
    .map((m) => ({ level: m[1].length, text: m[2].trim() }));
}

// 标题归一化：去掉「一、」「2.1 」「第3章」等序号前缀与标点，便于与大纲条目比对
export function normalizeHeading(text) {
  return String(text || '')
    .replace(/^[（(]?[一二三四五六七八九十]+[)）、.．]\s*/, '')
    .replace(/^\s*\d+(?:\.\d+)*[、.．]?\s*/, '')
    .replace(/^\s*第[一二三四五六七八九十百\d]+[章节節部分篇]\s*/, '')
    .replace(/[\s:：,，。.、（）()【】\[\]]/g, '')
    .trim();
}

// 判断是否为「声明性段落」：承担事实陈述、应当附证据的正文段落
export function isClaimParagraph(block) {
  const text = String(block || '').trim();
  if (!text) return false;
  if (/^[ \t]{0,3}#{1,6}\s/.test(text)) return false;   // 标题
  if (/^[ \t]*\|/.test(text)) return false;              // 表格行
  if (/^[ \t]*[-*+]\s/.test(text)) return false;         // 列表项
  if (/^[ \t]*[>\-=_]{3,}$/.test(text)) return false;    // 分隔线/引用块
  return text.length >= 40;
}

// 证据标记：[EVIDENCE:<id> source=<type>:<source_id> page=<n> chunk=<k>]
const EVIDENCE_MARKER_RE = /\[EVIDENCE:([^\s\]]+)([^\]]*)\]/g;

export function parseEvidenceMarkers(block) {
  const markers = [];
  for (const m of String(block || '').matchAll(EVIDENCE_MARKER_RE)) {
    const attrs = m[2] || '';
    markers.push({
      id: m[1],
      source: (/source=([^\s\]]+)/.exec(attrs) || [])[1] || '',
      page: (/page=([^\s\]]+)/.exec(attrs) || [])[1] || '',
      chunk: (/chunk=([^\s\]]+)/.exec(attrs) || [])[1] || '',
      quote: (/quote=/.test(attrs)),
    });
  }
  return markers;
}

// 单个证据标记的完备度：id + source + (page 或 chunk) 才算完全可溯源
export function markerWeight(marker) {
  if (!marker || !marker.id) return 0;
  if (marker.source && (marker.page || marker.chunk)) return 1;
  if (marker.source) return 0.6;
  return 0.3;
}

// 提取正文中的引文编号 [n]
export function extractCitationNumbers(text) {
  const body = stripBibliography(text);
  return [...body.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
}

// 提取「引文上下文」：(编号, 所在句子) 列表。
// 句子中剔除 [n] 编号与 [EVIDENCE:...] 标记本身，只留下真正的论点文本参与相似度计算，
// 否则标记里的 source/page/chunk 等字段会稀释词集，让相关度被系统性低估。
export function extractCitationContexts(text) {
  const clean = (s) => s.replace(/\[EVIDENCE:[^\]]*\]/g, ' ').replace(/\[\d+\]/g, ' ').replace(/\s+/g, ' ').trim();
  const contexts = [];
  for (const sentence of splitSentences(stripBibliography(text))) {
    if (!/\[\d+\]/.test(sentence)) continue;
    const stripped = clean(sentence);
    if (!stripped) continue;
    for (const m of sentence.matchAll(/\[(\d+)\]/g)) {
      contexts.push({ number: Number(m[1]), sentence: stripped });
    }
  }
  return contexts;
}

// 提取数值型断言：百分比 + 指标名后紧跟的数值。
// 刻意不提取年份/页码/章节号，避免把「2021 年」「第 112-125 页」误判为实验数据。
const PERCENT_RE = /(\d+(?:\.\d+)?)\s*%/g;
// 指标名与数值之间的间隔字符刻意排除方括号：否则「准确率普遍下降[2]」会把
// 引文编号里的 2 误当成指标数值，凭空多出一处「疑似编造」。
const METRIC_RE = new RegExp(
  `(准确率|精确率|召回率|查准率|查全率|错误率|误报率|漏报率|覆盖率|提升率|通过率|满意度|auc|psnr|ssim|bleu|rouge|dice|dsc|iou|f1|accuracy|precision|recall)[^0-9\\-+\\[\\]]{0,12}(-?\\d+(?:\\.\\d+)?)`,
  'gi'
);

export function extractNumericClaims(text) {
  // 先剔除引文编号与证据标记，再抽数值，避免把 [EVIDENCE:101 ...] 里的 id/page/chunk
  // 以及 [n] 编号当成实验数据。
  const source = stripBibliography(text)
    .replace(/\[EVIDENCE:[^\]]*\]/g, ' ')
    .replace(/\[\d+\]/g, ' ');
  const found = [];
  for (const m of source.matchAll(PERCENT_RE)) found.push({ raw: m[0], value: Number(m[1]), kind: 'percent' });
  for (const m of source.matchAll(METRIC_RE)) {
    const value = Number(m[2]);
    if (Number.isFinite(value)) found.push({ raw: m[0], value, kind: 'metric' });
  }
  // 去重：同一数值多次出现只记一次，避免长段落刷高编造计数
  const seen = new Set();
  return found.filter((item) => {
    const key = `${item.kind}:${item.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 把 benchmarks / references 里的所有数字摊平成可溯源数值池
export function collectTraceableNumbers(vars = {}) {
  const benchmarks = parseVarValue(vars.benchmarks, []) || [];
  const references = parseVarValue(vars.references, []) || [];
  const allowed = parseVarValue(vars.allowedNumbers, []) || [];
  const pool = new Set();
  const push = (v) => {
    const n = Number(v);
    if (Number.isFinite(n)) pool.add(n);
  };
  for (const item of allowed) push(item);
  for (const b of Array.isArray(benchmarks) ? benchmarks : []) {
    for (const m of b?.metrics || []) push(m?.value);
    for (const m of String(b?.paperTitle || '').matchAll(/\d+(?:\.\d+)?/g)) push(m[0]);
  }
  for (const r of Array.isArray(references) ? references : []) {
    for (const m of String(r?.abstract || '').matchAll(/\d+(?:\.\d+)?/g)) push(m[0]);
    for (const m of String(r?.title || '').matchAll(/\d+(?:\.\d+)?/g)) push(m[0]);
  }
  return [...pool];
}

// 参考文献条目是否出现在文末参考文献列表中（题名精确命中，或「第一作者 + 年份」命中）
export function referenceAppearsInBibliography(ref, bibliography) {
  const bib = String(bibliography || '').replace(/\s+/g, '');
  const title = String(ref?.title || '').replace(/\s+/g, '');
  if (title && bib.includes(title)) return true;
  const firstAuthor = String(ref?.authors || '').split(/[,，;；&]/)[0].trim().replace(/\s+/g, '');
  const year = String(ref?.year || '').trim();
  if (firstAuthor && year && bib.includes(firstAuthor) && bib.includes(year)) return true;
  return false;
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getRefs(context) {
  const vars = context?.vars || {};
  const refs = parseVarValue(vars.references, []);
  return Array.isArray(refs) ? refs : [];
}

function buildResult(pass, score, reason) {
  return { pass: !!pass, score: Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : (pass ? 1 : 0), reason };
}

// ===== 维度 1：引用是否真实存在 =====
// 正文出现的 [n] 必须能映射到传入的真实文献列表，且第 n 条文献确实出现在文末参考文献中；
// 正文里出现的 DOI 也必须能在文献列表中找到（防编造 DOI）。
export async function assertCitationsExist(output, context = {}) {
  const text = toText(output);
  const config = context.config || {};
  const refs = getRefs(context);
  const bibliography = extractBibliography(text);
  const numbers = [...new Set(extractCitationNumbers(text))];
  const issues = [];

  if (numbers.length === 0) {
    // 未提供文献列表时正文也不该出现编号引用；提供了却完全不引用则视为未按要求引用
    if (refs.length > 0 && config.requireCitations !== false) {
      return buildResult(false, 0, '正文未出现任何 [n] 引文编号，无法验证引用真实性（要求引用真实文献列表）');
    }
    return buildResult(true, 1, '未提供参考文献列表且正文无编号引用，跳过引用真实性校验');
  }

  if (refs.length === 0) {
    return buildResult(false, 0, `正文出现引文编号 ${numbers.join('/')}，但未提供真实文献列表，判定为编造引用`);
  }

  const outOfRange = numbers.filter((n) => n < 1 || n > refs.length);
  if (outOfRange.length > 0) {
    issues.push(`引文编号越界：${outOfRange.join('/')}（文献总数 ${refs.length}）`);
  }

  const unmapped = numbers
    .filter((n) => n >= 1 && n <= refs.length)
    .filter((n) => !referenceAppearsInBibliography(refs[n - 1], bibliography));
  if (unmapped.length > 0) {
    issues.push(`引文编号对应的文献未出现在文末参考文献：${unmapped.join('/')}`);
  }

  if (config.checkDoi !== false) {
    const refDois = refs.map((r) => String(r?.doi || '').trim()).filter(Boolean);
    const citedDois = [...stripBibliography(text).matchAll(/doi[:：]?\s*(10\.\d{4,9}\/[^\s,，；;)"']+)/gi)]
      .map((m) => m[1].replace(/[.,;]$/, ''));
    const fabricatedDoi = citedDois.filter((d) => !refDois.some((r) => r.toLowerCase().includes(d.toLowerCase()) || d.toLowerCase().includes(r.toLowerCase())));
    if (fabricatedDoi.length > 0) issues.push(`正文出现文献列表中不存在的 DOI：${fabricatedDoi.join('、')}`);
  }

  const ok = numbers.length - new Set([...outOfRange, ...unmapped]).size;
  const score = numbers.length ? Math.max(0, ok / numbers.length) : 0;
  if (issues.length > 0) return buildResult(false, score, issues.join('；'));
  return buildResult(true, 1, `${numbers.length} 个引文编号全部映射到真实文献列表`);
}

// ===== 维度 2：每条事实能否定位到证据 =====
// 声明性段落需带 [EVIDENCE:id source=... page=... chunk=...] 标记；可溯源段落占比即 score。
export async function assertEvidenceTraceable(output, context = {}) {
  const text = toText(output);
  const config = context.config || {};
  const threshold = num(config.minCoverage, DEFAULT_THRESHOLDS.evidenceCoverage);
  const body = stripBibliography(text);
  const claims = splitParagraphs(body).filter(isClaimParagraph);

  if (claims.length === 0) {
    return buildResult(false, 0, '正文没有可判定的声明性段落，无法验证证据可溯源性');
  }

  let weighted = 0;
  const untraced = [];
  for (const block of claims) {
    const markers = parseEvidenceMarkers(block);
    if (markers.length === 0) {
      untraced.push(block.slice(0, 24));
      continue;
    }
    weighted += Math.max(...markers.map(markerWeight));
  }
  const score = weighted / claims.length;
  if (score < threshold) {
    return buildResult(false, score, `可溯源段落占比 ${score.toFixed(2)} < ${threshold}；未标注证据的段落：${untraced.slice(0, 3).join(' / ')}`);
  }
  return buildResult(true, score, `可溯源段落占比 ${score.toFixed(2)}（共 ${claims.length} 个声明性段落）`);
}

// ===== 维度 3：引文是否支持对应论点（不是硬凑） =====
export async function assertCitationSupportsClaim(output, context = {}) {
  const text = toText(output);
  const config = context.config || {};
  const refs = getRefs(context);
  const simThreshold = num(config.minSimilarity, DEFAULT_THRESHOLDS.citationSimilarity);
  const ratioThreshold = num(config.minSupportRatio, DEFAULT_THRESHOLDS.citationSupportRatio);
  const contexts = extractCitationContexts(text);

  if (contexts.length === 0) {
    return buildResult(false, 0, '正文未出现 [n] 引文，无法校验引文与论点的相关性');
  }
  if (refs.length === 0) {
    return buildResult(false, 0, '未提供参考文献列表，无法校验引文与论点的相关性');
  }

  const details = [];
  for (const item of contexts) {
    const ref = refs[item.number - 1];
    if (!ref) {
      details.push({ number: item.number, similarity: 0, supported: false, reason: '编号越界' });
      continue;
    }
    const refText = [ref.title, ref.authors, ref.abstract, ref.journal].filter(Boolean).join(' ');
    const similarity = jaccardSimilarity(new Set(tokenizeText(item.sentence)), new Set(tokenizeText(refText)));
    details.push({ number: item.number, similarity, supported: similarity >= simThreshold });
  }
  const supported = details.filter((d) => d.supported).length;
  const ratio = supported / details.length;
  const weakest = details.slice().sort((a, b) => a.similarity - b.similarity).slice(0, 2)
    .map((d) => `[${d.number}] ${d.similarity.toFixed(3)}`);
  if (ratio < ratioThreshold) {
    return buildResult(false, ratio, `仅 ${supported}/${details.length} 条引文与所在论点语义相关（阈值 ${simThreshold}）；最低相关度：${weakest.join('、')}`);
  }
  return buildResult(true, ratio, `${supported}/${details.length} 条引文与所在论点语义相关`);
}

// ===== 维度 4：是否编造实验数据 =====
export async function assertNoFabricatedData(output, context = {}) {
  const text = toText(output);
  const config = context.config || {};
  const vars = context.vars || {};
  const tolerance = num(config.tolerance, 0.05);
  const maxUntraceable = num(config.maxUntraceable, 0);
  const claims = extractNumericClaims(text);

  if (claims.length === 0) {
    return buildResult(true, 1, '正文未出现数值型指标，无编造数据风险');
  }

  const pool = collectTraceableNumbers(vars);
  const traceable = (value) => pool.some((p) => Math.abs(p - value) <= tolerance);
  const untraceable = claims.filter((c) => !traceable(c.value));

  if (untraceable.length > maxUntraceable) {
    const score = Math.max(0, 1 - untraceable.length / claims.length);
    return buildResult(false, score, `疑似编造数值 ${untraceable.length} 处：${untraceable.map((c) => c.raw.trim()).join('、')}（benchmarks/文献摘要中均无来源）`);
  }
  return buildResult(true, 1, `${claims.length} 处数值全部可溯源到 benchmarks 或文献摘要`);
}

// ===== 维度 5：大纲与正文是否一致 =====
export function matchOutline(headings, outline) {
  const normalizedHeadings = headings.map((h) => normalizeHeading(h.text));
  const positions = [];
  const missing = [];
  for (const entry of outline) {
    const target = normalizeHeading(entry);
    if (!target) continue;
    let idx = normalizedHeadings.findIndex((h) => h === target || h.includes(target) || target.includes(h));
    if (idx === -1 && target.length >= 2) {
      // 退化匹配：允许「研究方法」与「研究方法与技术路线」互为包含（取首 2 字交叉验证）
      idx = normalizedHeadings.findIndex((h) => h.length >= 2 && h.includes(target.slice(0, 2)) && target.includes(h.slice(0, 2)));
    }
    if (idx === -1) missing.push(entry);
    else positions.push({ entry, idx });
  }
  let ordered = true;
  for (let i = 1; i < positions.length; i += 1) {
    if (positions[i].idx < positions[i - 1].idx) ordered = false;
  }
  const coverage = outline.length ? positions.length / outline.length : 1;
  return { coverage, missing, ordered, positions };
}

export async function assertOutlineConsistency(output, context = {}) {
  const text = toText(output);
  const config = context.config || {};
  const vars = context.vars || {};
  const outline = parseVarValue(vars.outline, []) || [];
  if (!Array.isArray(outline) || outline.length === 0) {
    return buildResult(true, 1, '未指定大纲，跳过大纲一致性校验');
  }
  const minCoverage = num(config.minCoverage, 1);
  const headings = extractHeadings(text);
  const { coverage, missing, ordered } = matchOutline(headings, outline);
  const issues = [];
  if (coverage < minCoverage) issues.push(`正文未覆盖大纲章节：${missing.join('、')}`);
  if (config.requireOrder !== false && !ordered) issues.push('正文章节顺序与大纲不一致');
  if (issues.length > 0) return buildResult(false, coverage, issues.join('；'));
  return buildResult(true, coverage, `正文覆盖大纲 ${Math.round(coverage * 100)}%（${outline.length} 个章节）且顺序一致`);
}

// ===== 维度 6：章节之间是否重复或矛盾 =====
const POSITIVE_CLAIM_PATTERNS = ['显著提升', '显著改善', '显著提高', '明显提高', '大幅提高', '大幅降低', '显著优于', '优于基线', '存在显著差异', '具有显著差异', '效果显著', '准确率提升', '性能提升'];
const NEGATIVE_CLAIM_PATTERNS = ['无显著差异', '没有显著差异', '未观察到显著', '不存在显著差异', '差异不显著', '并无显著', '效果有限', '未达显著', '没有明显改善'];

export function splitSections(text) {
  const source = stripBibliography(text);
  const lines = source.split(/\r?\n/);
  const sections = [];
  let current = null;
  for (const line of lines) {
    const m = /^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    if (m && m[1].length <= 3) {
      if (current) sections.push(current);
      current = { title: m[2].trim(), body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  if (current) sections.push(current);
  return sections.map((s) => ({ title: s.title, body: s.body.join('\n').trim() })).filter((s) => s.body.length > 0);
}

export function detectContradictions(sections, similarityThreshold = DEFAULT_THRESHOLDS.contradictionSimilarity) {
  const hits = [];
  for (let i = 0; i < sections.length; i += 1) {
    for (let j = i + 1; j < sections.length; j += 1) {
      const aSentences = splitSentences(sections[i].body);
      const bSentences = splitSentences(sections[j].body);
      const aPos = aSentences.filter((s) => POSITIVE_CLAIM_PATTERNS.some((p) => s.includes(p)));
      const aNeg = aSentences.filter((s) => NEGATIVE_CLAIM_PATTERNS.some((p) => s.includes(p)));
      const bPos = bSentences.filter((s) => POSITIVE_CLAIM_PATTERNS.some((p) => s.includes(p)));
      const bNeg = bSentences.filter((s) => NEGATIVE_CLAIM_PATTERNS.some((p) => s.includes(p)));
      const pairs = [
        { from: aPos, to: bNeg },
        { from: aNeg, to: bPos },
      ];
      for (const pair of pairs) {
        for (const s1 of pair.from) {
          for (const s2 of pair.to) {
            const sim = jaccardSimilarity(new Set(tokenizeText(s1)), new Set(tokenizeText(s2)));
            if (sim >= similarityThreshold) {
              hits.push({
                a: sections[i].title, b: sections[j].title, similarity: sim,
                sentenceA: s1.slice(0, 40), sentenceB: s2.slice(0, 40),
              });
            }
          }
        }
      }
    }
  }
  return hits;
}

export async function assertNoDuplicateOrContradiction(output, context = {}) {
  const text = toText(output);
  const config = context.config || {};
  const duplicateThreshold = num(config.duplicateThreshold, DEFAULT_THRESHOLDS.sectionDuplicate);
  const contradictionThreshold = num(config.contradictionSimilarity, DEFAULT_THRESHOLDS.contradictionSimilarity);
  const sections = splitSections(text);
  if (sections.length < 2) {
    return buildResult(true, 1, '章节数不足 2，跳过重复/矛盾校验');
  }

  const issues = [];
  let maxSimilarity = 0;
  let duplicatePair = null;
  for (let i = 0; i < sections.length; i += 1) {
    for (let j = i + 1; j < sections.length; j += 1) {
      const sim = jaccardSimilarity(new Set(tokenizeText(sections[i].body)), new Set(tokenizeText(sections[j].body)));
      if (sim > maxSimilarity) {
        maxSimilarity = sim;
        duplicatePair = [sections[i].title, sections[j].title];
      }
    }
  }
  if (maxSimilarity > duplicateThreshold) {
    issues.push(`章节高度重复：${duplicatePair[0]} 与 ${duplicatePair[1]} 相似度 ${maxSimilarity.toFixed(2)}`);
  }

  const contradictions = detectContradictions(sections, contradictionThreshold);
  if (contradictions.length > 0) {
    const top = contradictions[0];
    issues.push(`章节表述互斥：${top.a}「${top.sentenceA}」与 ${top.b}「${top.sentenceB}」`);
  }

  if (issues.length > 0) return buildResult(false, Math.max(0, 1 - issues.length / 2), issues.join('；'));
  return buildResult(true, 1, `${sections.length} 个章节无重复、无互斥表述（最高相似度 ${maxSimilarity.toFixed(2)}）`);
}

// ===== 维度 7：字数、格式、术语、参考文献格式 =====
const FORBIDDEN_PATTERNS = [
  { name: '引用占位符 [CITE:n]', re: /\[CITE:\d+\]/ },
  { name: '图表占位符 [CHART:...]', re: /\[CHART:[^\]]+\]/ },
  { name: '模板占位符 {{...}}', re: /\{\{[^}]+\}\}/ },
  { name: '数据分隔符 <<<USER_CONTENT>>>', re: /<<<USER_CONTENT>>>/ },
];

export function countReferenceEntries(text) {
  const bib = extractBibliography(text);
  if (!bib.trim()) return 0;
  return [...bib.matchAll(/^[ \t]*(?:\[\d+\]|\d+[.、])[ \t]+\S+/gm)].length;
}

// GB/T 7714 粗检：编号 + 责任者「. 」+ 题名 + 4 位年份
export function checkReferenceFormat(text) {
  const bib = extractBibliography(text);
  const bad = [];
  for (const line of bib.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !/^(?:\[\d+\]|\d+[.、])/.test(trimmed)) continue;
    const hasYear = /\b(19|20)\d{2}\b/.test(trimmed);
    const hasSeparator = /[.．]/.test(trimmed);
    if (!hasYear || !hasSeparator) bad.push(trimmed.slice(0, 40));
  }
  return bad;
}

export async function assertFormatCompliance(output, context = {}) {
  const text = toText(output);
  const config = context.config || {};
  const vars = context.vars || {};
  const minLength = num(config.minLength ?? vars.min_length, 200);
  const minReferences = num(config.minReferences ?? vars.min_references, 0);
  const rawTerms = config.terms ?? vars.terms ?? '';
  const requiredTerms = String(rawTerms).split(/[,，;；]/).map((s) => s.trim()).filter(Boolean);

  const checks = [];
  const issues = [];

  checks.push('length');
  const length = text.trim().length;
  if (length < minLength) issues.push(`字数不足（${length} < ${minLength}）`);

  for (const pattern of FORBIDDEN_PATTERNS) {
    checks.push(`placeholder:${pattern.name}`);
    if (pattern.re.test(text)) issues.push(`存在未替换的${pattern.name}`);
  }

  checks.push('mojibake');
  if (/\uFFFD/.test(text)) issues.push('存在乱码替换符（U+FFFD）');
  if (/[\uD800-\uDFFF]/.test(text)) issues.push('存在未配对的代理字符');

  if (minReferences > 0) {
    checks.push('references');
    const count = countReferenceEntries(text);
    if (count < minReferences) issues.push(`参考文献条数不足（${count} < ${minReferences}）`);
  }

  if (requiredTerms.length > 0) {
    checks.push('terms');
    const missing = requiredTerms.filter((t) => !text.includes(t));
    if (missing.length > 0) issues.push(`缺少必备术语：${missing.join('、')}`);
  }

  if (config.requireReferenceFormat === true) {
    checks.push('reference-format');
    const bad = checkReferenceFormat(text);
    if (bad.length > 0) issues.push(`参考文献格式不规范（缺年份或分隔符）：${bad.join(' / ')}`);
  }

  const score = checks.length ? Math.max(0, 1 - issues.length / checks.length) : 0;
  if (issues.length > 0) return buildResult(false, score, issues.join('；'));
  return buildResult(true, 1, `格式合规（${length} 字，${checks.length} 项检查全部通过）`);
}

// ===== 维度 8：同一输入多次生成是否稳定 =====
// 稳定性不是单条输出的属性，无法只靠 (output, context) 判断，因此在断言内部
// 复用 provider 的生成入口再跑 N 次，与当前输出做结构与关键事实比对。
export async function assertStability(output, context = {}) {
  const config = context.config || {};
  const vars = context.vars || {};
  const runs = Math.max(2, Math.min(8, num(config.runs ?? vars.runs, 3)));
  const threshold = num(config.threshold, DEFAULT_THRESHOLDS.stability);
  const { measureStability } = await import('./promptfoo-stability.mjs');
  const result = await measureStability({
    vars,
    runs,
    baseline: toText(output),
    config,
  });
  return buildResult(result.pass, result.score, result.reason);
}

// 断言注册表：既便于测试按名取用，也是默认导出调度函数的查找表。
export const ASSERTIONS = {
  assertCitationsExist,
  assertEvidenceTraceable,
  assertCitationSupportsClaim,
  assertNoFabricatedData,
  assertOutlineConsistency,
  assertNoDuplicateOrContradiction,
  assertFormatCompliance,
  assertStability,
};

// 默认导出必须是「函数」：promptfoo 0.100.6 加载 file:// 断言后，
// 只接受模块本身是函数或 module.default 是函数（对象会被判定为 malformed）。
// 具体执行哪个断言，由用例在 assert.config.fn 中指定。
export default async function runAssertion(output, context = {}) {
  const fnName = context?.config?.fn;
  if (typeof fnName !== 'string' || !fnName) {
    return buildResult(
      false,
      0,
      `缺少 config.fn：请在用例的 assert 配置中指定断言函数名，可选：${Object.keys(ASSERTIONS).join(', ')}`
    );
  }
  const fn = ASSERTIONS[fnName];
  if (typeof fn !== 'function') {
    return buildResult(
      false,
      0,
      `未知断言函数：${fnName}，可选：${Object.keys(ASSERTIONS).join(', ')}`
    );
  }

  const raw = await fn(output, context);
  const result = normalizeResult(raw);

  // 反例用例（metadata.expectation: fail）：被测输出是「应当被判不合格」的坏样本。
  // 此时断言本身判 fail 才说明它正确检出了问题，评测应记为通过；反之若断言放行
  // 了坏样本，说明断言失效，评测应记为失败。故对 pass/score 取反。
  if (context?.test?.metadata?.expectation === 'fail') {
    return buildResult(
      !result.pass,
      result.pass ? 0 : 1,
      `[反例] ${result.reason || (result.pass ? '断言未检出预期问题' : '断言已按预期检出问题')}`
    );
  }
  return result;
}

// 断言可能返回 boolean / number / {pass, score, reason}，统一成对象便于取反与计分。
function normalizeResult(raw) {
  if (raw == null) return buildResult(false, 0, '断言返回空结果');
  if (typeof raw === 'boolean') return buildResult(raw, raw ? 1 : 0, raw ? '通过' : '未通过');
  if (typeof raw === 'number') return buildResult(raw > 0, Math.max(0, Math.min(1, raw)), `得分 ${raw}`);
  return buildResult(raw.pass, raw.score ?? (raw.pass ? 1 : 0), raw.reason || '');
}

// GROBID 解析通道（可选插件）
//
// GROBID 擅长「参考文献与文内引用关系」的抽取：把参考文献条目结构化成 TEI biblStruct，
// 并把正文中的引用标记（<ref type="bibr" target="#b0">）与参考文献条目对应起来。
// 这正是「引文是否支持论点」核验所必需的结构，MinerU/Docling/pdfjs 都提供不了。
// 未配置 GROBID_URL 时整个通道静默跳过，绝不阻断主流程。
//
// 官方契约依据（写代码前已核实，勿凭记忆改字段名）：
//   1. GROBID 服务 API
//      https://grobid.readthedocs.io/en/release-0.9.0/Grobid-service
//      - 端点：POST /api/processFulltextDocument（multipart，**文件字段名固定为 input**）
//      - 可选参数：consolidateCitations=0|1|2、includeRawCitations=0|1、
//                  teiCoordinates=<元素名>（可重复传多个：ref / head / biblStruct / figure / p ...）
//      - 响应：TEI XML 文本；HTTP 204 表示处理成功但没抽出内容
//   2. PDF 坐标
//      https://grobid.readthedocs.io/en/latest/Coordinates-in-PDF/
//      - @coords 格式：多个包围盒以 `;` 分隔，每个包围盒为 `page,x,y,w,h`（5 个值，逗号分隔）
//      - 页码是包围盒的第一个值，且 **第一页的索引是 1**（PDF 惯例）
//      - 只有请求了 teiCoordinates=ref，正文里的引用标记才会带 @coords
//   3. TEI 输出结构（GROBID 对 TEI 的定制编码）
//      https://grobid.readthedocs.io/en/latest/TEI-encoding-of-results/
//      - 标题：teiHeader/fileDesc/sourceDesc/biblStruct/analytic/title
//      - 作者：.../analytic/author/persName/forename + surname
//      - 期刊：.../monogr/title[@level="j"]；日期：.../monogr/imprint/date/@when
//      - DOI：.../idno[@type="DOI"]
//      - 摘要：teiHeader/profileDesc/abstract
//      - 正文：text/body/div（含 head 子标题 + p 段落，div 可嵌套）
//      - 参考文献：text/back/div[@type="references"]/listBibl/biblStruct[@xml:id="b0"]
//
// 设计原则：
//   - TEI 默认带命名空间 xmlns="http://www.tei-c.org/ns/1.0"。这里先用正则剥掉 xmlns 声明
//     再交给 xmldom 解析，同时所有标签匹配都走 localName（去掉前缀），双保险；
//   - 解析逻辑集中在纯函数 parseGrobidTei(xmlText) 中，可脱离网络直接单测；
//   - 所有失败一律 throw，由上层 document-parser 负责降级。
import { DOMParser } from '@xmldom/xmldom';
import { assertSafeAiResolvedUrl } from '../utils.js';
import logger from '../logger.js';

const DEFAULT_TIMEOUT_MS = 60000;
const MAX_TIMEOUT_MS = 600000;

// 需要 GROBID 回传坐标的元素：ref（文内引用标记→页码）、head（章节标题→页码）、
// biblStruct（参考文献条目→页码）、figure（图表）
const TEI_COORDINATES = ['ref', 'head', 'biblStruct', 'figure'];

// 引用上下文的最大字符数：够模型判断「引文是否支持论点」，又不至于撑爆证据块
const MAX_CONTEXT_CHARS = 600;

// 单文档最多保留的段落块数
const MAX_BLOCKS = 4000;

// 遍历 DOM 时的深度上限（防御性约束）
const MAX_TREE_DEPTH = 32;

function readConfig() {
  const base = String(process.env.GROBID_URL || '').trim().replace(/\/+$/, '');
  const rawTimeout = Number(process.env.GROBID_TIMEOUT_MS);
  const timeout = Number.isFinite(rawTimeout) && rawTimeout > 0
    ? Math.min(rawTimeout, MAX_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS;
  // consolidate：0=不做外部校验，1=补全全部元数据，2=只补 DOI。默认 1（用户约定）
  const consolidate = String(process.env.GROBID_CONSOLIDATE || '1').trim() || '1';
  return { base, timeout, consolidate };
}

// 是否配置了 GROBID 服务（未配置时上层直接跳过该通道，不发任何网络请求）
export function isGrobidConfigured() {
  return Boolean(readConfig().base);
}

function cleanText(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

// 取 localName（剥掉可能存在的命名空间前缀），兼容带/不带 xmlns 两种输入
function localNameOf(node) {
  const raw = String(node?.localName || node?.nodeName || '');
  const idx = raw.indexOf(':');
  return idx >= 0 ? raw.slice(idx + 1) : raw;
}

// 取元素的直接子元素中指定标签的那些（不用 getElementsByTagName：那会穿透嵌套 div）
function childElements(el, name) {
  const out = [];
  for (let n = el?.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && localNameOf(n) === name) out.push(n);
  }
  return out;
}

// xmldom 的 NodeList 不可迭代（没有 Symbol.iterator），只能按下标取。
// 这里统一转真数组，避免下游写 for...of / .find 时踩坑（已实测确认）。
function elementsByTag(scope, name) {
  const found = scope?.getElementsByTagName?.(name);
  if (!found) return [];
  const out = [];
  for (let i = 0; i < found.length; i++) out.push(found[i]);
  return out;
}

// 取第一个后代元素（按 localName 匹配，深度优先）
function firstDescendant(el, name) {
  if (!el) return null;
  const found = el.getElementsByTagName?.(name);
  return found && found.length > 0 ? found[0] : null;
}

function textOf(el) {
  return el ? cleanText(el.textContent) : '';
}

// 解析 GROBID 的 @coords：取第一个包围盒的页码
// 格式 "page,x,y,w,h[;page,x,y,w,h...]"，页码从 1 开始
export function pageFromCoords(coords) {
  const s = String(coords || '').trim();
  if (!s) return null;
  const firstBox = s.split(';')[0];
  const page = toInt(firstBox.split(',')[0], 0);
  return page > 0 ? page : null;
}

// 取元素自身或其最近祖先中第一个指定标签的元素（用于找 ref 所在的段落/句子）
function closestAncestor(el, names) {
  const wanted = new Set(names);
  let node = el;
  let depth = 0;
  while (node && depth < MAX_TREE_DEPTH) {
    if (wanted.has(localNameOf(node))) return node;
    node = node.parentNode;
    depth++;
  }
  return null;
}

function parseAuthors(scope) {
  const authors = [];
  const seen = new Set();
  for (const persName of elementsByTag(scope, 'persName')) {
    // 只认 author 下的 persName（biblStruct 里还可能有 editor 的 persName）
    let parent = persName.parentNode;
    let isAuthor = false;
    let depth = 0;
    while (parent && depth < 4) {
      if (localNameOf(parent) === 'author') { isAuthor = true; break; }
      if (localNameOf(parent) === 'editor') break;
      parent = parent.parentNode;
      depth++;
    }
    if (!isAuthor) continue;
    const surname = textOf(firstDescendant(persName, 'surname'));
    const forename = textOf(firstDescendant(persName, 'forename'));
    const name = cleanText([forename, surname].filter(Boolean).join(' '))
      || cleanText(persName.textContent);
    if (name && !seen.has(name)) {
      seen.add(name);
      authors.push(name);
    }
  }
  return authors;
}

// 从 biblStruct（或任意作用域）里取 DOI：GROBID 用 <idno type="DOI">
function doiOf(scope) {
  for (const idno of elementsByTag(scope, 'idno')) {
    const type = String(idno.getAttribute?.('type') || '').toUpperCase();
    const value = cleanText(idno.textContent);
    if (type === 'DOI' && value) return value;
  }
  return '';
}

// 年份：优先 date[@type="published"]/@when，退回任意 date/@when，最后用文本里的 4 位年
function yearOf(scope) {
  const dates = elementsByTag(scope, 'date');
  for (const d of dates) {
    if (String(d.getAttribute?.('type') || '') === 'published') {
      const when = String(d.getAttribute?.('when') || '');
      const y = when.slice(0, 4);
      if (/^\d{4}$/.test(y)) return y;
    }
  }
  for (const d of dates) {
    const when = String(d.getAttribute?.('when') || '');
    const y = when.slice(0, 4);
    if (/^\d{4}$/.test(y)) return y;
  }
  const m = /\b(19|20)\d{2}\b/.exec(textOf(scope));
  return m ? m[0] : '';
}

function journalOf(bibl) {
  for (const t of elementsByTag(bibl, 'title')) {
    if (String(t.getAttribute?.('level') || '') === 'j') return cleanText(t.textContent);
  }
  return '';
}

// 主标题：优先 analytic 下的 title（论文题名），退回 monogr/title[@level="m"]（书籍/报告题名）
function titleOf(bibl) {
  const analytic = firstDescendant(bibl, 'analytic');
  if (analytic) {
    for (const t of childElements(analytic, 'title')) {
      const s = cleanText(t.textContent);
      if (s) return s;
    }
  }
  for (const t of elementsByTag(bibl, 'title')) {
    const level = String(t.getAttribute?.('level') || '');
    if (level === 'm' || level === 'a') {
      const s = cleanText(t.textContent);
      if (s) return s;
    }
  }
  const anyTitle = firstDescendant(bibl, 'title');
  return anyTitle ? cleanText(anyTitle.textContent) : '';
}

// 解析一个 biblStruct（参考文献条目）
function parseBiblStruct(bibl) {
  // xml:id 在 xmlns 剥离后可能被解析成 id，两种都试
  const refId = String(bibl.getAttribute?.('xml:id') || bibl.getAttribute?.('id') || '').trim();
  const analytic = firstDescendant(bibl, 'analytic');
  const authorScope = analytic || bibl;
  const rawNote = elementsByTag(bibl, 'note')
    .find((n) => String(n.getAttribute?.('type') || '') === 'raw_reference');
  return {
    ref_id: refId,
    title: titleOf(bibl),
    authors: parseAuthors(authorScope),
    year: yearOf(bibl),
    journal: journalOf(bibl),
    doi: doiOf(bibl),
    raw: rawNote ? cleanText(rawNote.textContent) : '',
  };
}

// 递归遍历正文 div：head 作为章节标题，p 作为段落块。div 可嵌套（章→节）
function walkBody(bodyEl, { onParagraph }) {
  const visit = (divEl, sectionTitle, sectionPage, depth) => {
    if (depth > MAX_TREE_DEPTH) return;
    const directHeads = childElements(divEl, 'head');
    const head = directHeads[0] || null;
    const title = head ? textOf(head) : sectionTitle;
    const page = head ? (pageFromCoords(head.getAttribute?.('coords')) ?? sectionPage) : sectionPage;

    for (const p of childElements(divEl, 'p')) {
      const text = textOf(p);
      if (!text) continue;
      onParagraph({
        page_number: pageFromCoords(p.getAttribute?.('coords')) ?? page,
        section_title: title,
        text,
        block_type: 'text',
      });
    }

    for (const child of childElements(divEl, 'div')) {
      visit(child, title, page, depth + 1);
    }
  };

  for (const div of childElements(bodyEl, 'div')) visit(div, '', null, 0);
}

// 抽取文内引用：<ref type="bibr" target="#b0 [#b1 ...]">[1]</ref>
// context 取该标记所在的那个句子/段落文本，用于核验「引文是否支持论点」
function collectCitations(root) {
  const citations = [];
  const seen = new Set();
  for (const ref of elementsByTag(root, 'ref')) {
    if (String(ref.getAttribute?.('type') || '') !== 'bibr') continue;
    const targets = String(ref.getAttribute?.('target') || '')
      .split(/\s+/)
      .map((t) => t.replace(/^#/, '').trim())
      .filter(Boolean);
    if (targets.length === 0) continue;

    const marker = cleanText(ref.textContent);
    const page = pageFromCoords(ref.getAttribute?.('coords'));
    // 优先取所在句子（开了 segmentSentences 时是 <s>），否则取所在段落 <p>
    const scope = closestAncestor(ref, ['s', 'p']);
    const context = cleanText(scope ? scope.textContent : '').slice(0, MAX_CONTEXT_CHARS);

    for (const refId of targets) {
      const key = `${refId}|${marker}|${page}|${context}`;
      if (seen.has(key)) continue;
      seen.add(key);
      citations.push({ ref_id: refId, page_number: page, context, marker });
    }
  }
  return citations;
}

// 剥掉 xmlns 声明：GROBID 输出默认带 TEI 命名空间，剥掉后 getElementsByTagName
// 才能直接用无前缀的标签名命中（xmldom 对命名空间支持不完整，这是最省心的做法）
function stripNamespaces(xmlText) {
  return String(xmlText || '').replace(/\s+xmlns(?::[\w.-]+)?\s*=\s*(?:"[^"]*"|'[^']*')/g, '');
}

/**
 * 纯函数：解析 GROBID 的 TEI XML 为统一结构（导出以便脱离网络单测）
 * @param {string} xmlText TEI XML 文本
 * @returns {{ blocks, sections, metadata, references, citations, tables, parser: 'grobid' }}
 */
export function parseGrobidTei(xmlText) {
  const text = String(xmlText || '').trim();
  if (!text) throw new Error('GROBID 返回空 XML');

  let doc = null;
  try {
    doc = new DOMParser().parseFromString(stripNamespaces(text), 'text/xml');
  } catch (err) {
    throw new Error(`GROBID TEI XML 解析失败: ${err.message}`);
  }
  if (!doc?.documentElement) throw new Error('GROBID TEI XML 解析失败：无根元素');

  // ===== 元信息 =====
  const biblStruct = firstDescendant(doc, 'biblStruct');
  const analytic = biblStruct ? firstDescendant(biblStruct, 'analytic') : null;
  const abstractEl = firstDescendant(doc, 'abstract');

  let title = '';
  if (analytic) {
    title = childElements(analytic, 'title').map(textOf).find(Boolean) || '';
  }
  if (!title) {
    const titleStmt = firstDescendant(doc, 'titleStmt');
    title = titleStmt ? (childElements(titleStmt, 'title').map(textOf).find(Boolean) || '') : '';
  }
  if (!title && biblStruct) title = titleOf(biblStruct);

  const metadata = {
    title,
    authors: biblStruct ? parseAuthors(analytic || biblStruct) : [],
    doi: doiOf(biblStruct),
    year: yearOf(biblStruct),
    abstract: textOf(abstractEl),
    journal: biblStruct ? journalOf(biblStruct) : '',
  };

  // ===== 正文：段落块 + 章节 =====
  const bodyEl = firstDescendant(doc, 'body');
  const blocks = [];
  const sectionMap = new Map();
  if (bodyEl) {
    walkBody(bodyEl, {
      onParagraph: (block) => {
        if (blocks.length < MAX_BLOCKS) blocks.push(block);
        const key = block.section_title || '';
        if (!sectionMap.has(key)) {
          sectionMap.set(key, { title: key, page_number: block.page_number, text: '' });
        }
        const section = sectionMap.get(key);
        if (!section.page_number) section.page_number = block.page_number;
        section.text = section.text ? `${section.text}\n${block.text}` : block.text;
      },
    });
  }
  const sections = [...sectionMap.values()];

  // ===== 参考文献 =====
  const references = [];
  const listBibl = firstDescendant(doc, 'listBibl');
  if (listBibl) {
    for (const bibl of childElements(listBibl, 'biblStruct')) {
      references.push(parseBiblStruct(bibl));
    }
  } else if (biblStruct) {
    // processReferences / 退化场景：文档根下直接挂着 biblStruct 列表
    for (const bibl of elementsByTag(doc, 'biblStruct')) {
      const parsed = parseBiblStruct(bibl);
      // 跳过源文档自身（在 sourceDesc 里的那个）
      if (parsed.title && parsed.title === metadata.title) continue;
      references.push(parsed);
    }
  }

  // ===== 文内引用标记 =====
  const citations = collectCitations(doc);

  // GROBID 不产出表格结构（figure 元素里的 <table> 极少且不稳定），统一返回空
  return { blocks, sections, metadata, references, citations, tables: [], parser: 'grobid' };
}

/**
 * 调用 GROBID 解析 PDF（参考文献 + 文内引用 + 正文结构）
 * @param {Buffer|Uint8Array} pdfBytes PDF 字节
 * @returns {Promise<{ blocks, sections, metadata, references, citations, tables, parser: 'grobid' }>}
 * @throws 任何失败都抛出，由上层统一降级
 */
export async function parsePdfViaGrobid(pdfBytes) {
  const { base, timeout, consolidate } = readConfig();
  if (!base) throw new Error('未配置 GROBID_URL');
  if (!pdfBytes || pdfBytes.length === 0) throw new Error('PDF 内容为空');

  const url = `${base}/api/processFulltextDocument`;
  // SSRF 防护：GROBID 是管理员自部署的内部服务，允许私网，但仍要拦截
  // 回环/链路本地/云元数据端点，且每次请求前重新校验
  await assertSafeAiResolvedUrl(url, { allowPrivate: true });

  const form = new FormData();
  // 字段名必须是 input —— GROBID 服务端只认这个（不是 file / files）
  form.append('input', new Blob([pdfBytes], { type: 'application/pdf' }), 'document.pdf');
  // 请求原始引用串，便于在参考文献结构化失败时仍能回显原文
  form.append('includeRawCitations', '1');
  form.append('consolidateCitations', consolidate);
  for (const element of TEI_COORDINATES) form.append('teiCoordinates', element);

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(timeout),
      redirect: 'manual',
    });
  } catch (err) {
    throw new Error(`GROBID 请求失败: ${err.message}`);
  }
  // 禁止跟随重定向：防止校验通过后被 3xx 带到内网/元数据端点
  if (resp.status >= 300 && resp.status < 400) throw new Error('GROBID 响应不允许重定向');
  // 204 是 GROBID 的合法响应：处理完成但没抽出任何内容，按失败处理以便上层降级
  if (resp.status === 204) throw new Error('GROBID 未抽出内容（HTTP 204）');
  if (!resp.ok) throw new Error(`GROBID HTTP ${resp.status}`);

  const xmlText = await resp.text();
  const parsed = parseGrobidTei(xmlText);
  if (parsed.blocks.length === 0 && parsed.references.length === 0 && parsed.citations.length === 0) {
    throw new Error('GROBID 响应缺少可解析内容');
  }
  if (parsed.blocks.length === 0) {
    logger.warn('grobid-client', 'GROBID 未抽出正文段落，仅返回参考文献/引用');
  }
  return parsed;
}

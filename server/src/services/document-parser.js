// 学术文档统一解析层（四通道路由 + 降级链）
//
// 背景：原先只有「MinerU（可选）→ 内置 pdfjs（兜底）」两条通道。MinerU 一旦失败直接
// 回退 pdfjs，章节、页码、表格、参考文献与文内引用标记全部丢失，下游「段落级证据库」
// 拿不到 page_number / section_title，引用核验的准确性上不去。
//
// 本模块把解析收敛成四通道路由，任何一条失败都自动落到下一条，并把走过的路径记在
// attempts 里供前端与日志展示：
//   mineru  —— 中文复杂版式 / 扫描件（https://github.com/opendatalab/MinerU）
//   docling —— 英文与通用学术 PDF，布局/阅读顺序/表格结构（MIT，docling-serve）
//   grobid  —— 参考文献条目 + 文内引用标记与参考文献的对应关系
//   pdfjs   —— 纯文本兜底（内置，零部署依赖）
//
// 关键约束：Docling / GROBID 都是**可选插件**。未配置环境变量时静默跳过（attempts 里
// 记一条"未配置"），绝不阻断主流程。
//
// 出站安全：所有访问外部服务的请求都先过 assertSafeAiResolvedUrl。Docling / GROBID /
// MinerU 属于管理员自部署的内部服务，用 allowPrivate: true；并禁止跟随重定向
// （redirect: 'manual' + 拒绝 3xx），防止校验通过后被跳到内网/云元数据端点。
import {
  isDoclingConfigured,
  parsePdfViaDocling,
  blocksFromMarkdown,
} from './docling-client.js';
import {
  isGrobidConfigured,
  parsePdfViaGrobid,
} from './grobid-client.js';
// htmlTableToRows / parsePdfViaPdfjs 复用 paper-distillation 里已稳定且被测试覆盖的实现，
// 不重复造轮子（注意：paper-distillation 的 extractPdfText 反过来会调用本模块的
// parseDocument，构成 ESM 循环依赖；两者导出都是函数声明（会被提升），因此循环安全）
import { htmlTableToRows, parsePdfViaPdfjs } from './paper-distillation.js';
import { assertSafeAiResolvedUrl } from '../utils.js';
import logger from '../logger.js';

// pdfjs 兜底最多解析的页数（与 paper-distillation 的 PDF_MAX_PAGES 保持一致）
const PDFJS_MAX_PAGES = 15;
// pdfjs 解析超时：损坏/特殊构造的 PDF 可能让解析长期挂起，拖死请求与任务
const PDFJS_TIMEOUT_MS = 60_000;
// 语言嗅探只读前几页，够了（中文/英文在这点样本上区分度已足够）
const LANGUAGE_PROBE_PAGES = 2;
// 中文字符占比阈值：> 20% 判定为中文（简单启发式，够用且可预测）
const CJK_RATIO_THRESHOLD = 0.2;
// 单文档最多保留的文本块数
const MAX_BLOCKS = 4000;

const EMPTY_METADATA = { title: '', authors: [], doi: '', year: '', abstract: '', journal: '' };

// 未配置各通道时写入 attempts 的提示（同时也是给运维看的排查线索）
const MISSING_ENV_HINT = {
  mineru: '未配置 MINERU_API_URL，跳过该通道',
  docling: '未配置 DOCLING_API_URL，跳过该通道',
  grobid: '未配置 GROBID_API_URL，跳过该通道',
};

// ===== 通道开关（读取时求值，便于测试用 env 打桩） =====
export function isMinerUEnabled() {
  return Boolean(String(process.env.MINERU_API_URL || '').trim());
}
export function isDoclingEnabled() {
  return isDoclingConfigured();
}
export function isGrobidEnabled() {
  return isGrobidConfigured();
}

function cleanText(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/**
 * 语言启发式判断：中文（含汉字）字符占比 > 20% 判为 zh，否则 en
 * 仅看非空白字符，避免大量空白/换行稀释占比
 * @param {string} text
 * @returns {'zh'|'en'}
 */
export function detectLanguage(text) {
  const s = String(text || '').replace(/\s/g, '');
  if (!s) return 'en';
  const han = (s.match(/\p{Script=Han}/gu) || []).length;
  return han / s.length > CJK_RATIO_THRESHOLD ? 'zh' : 'en';
}

// 把调用方给的语言提示归一化成 'zh' / 'en'（认常见写法，认不出就返回空串交给嗅探）
function normalizeLanguageHint(hint) {
  const h = String(hint || '').trim().toLowerCase();
  if (!h) return '';
  if (/^(zh|zh[-_](cn|hans|tw|hk)|chi|zho|chinese|中文|汉语)$/.test(h)) return 'zh';
  if (/^(en|eng|english|英文|英语)$/.test(h)) return 'en';
  return '';
}

// ===== pdfjs 兜底：逐页解析以保留页码 =====
// paper-distillation 的 parsePdfViaPdfjs 返回的是跨页拼接后的扁平行数组，页码信息在
// 拼接时已丢弃；而证据库要求 page_number，所以这里做一版逐页版本。
// 若逐页版本失败（pdfjs 版本差异等），再退回复用的扁平版本（丢页码但至少出文本）。
async function parsePdfViaPdfjsPages(pdfBytes) {
  const getDocument = (await import('pdfjs-dist/legacy/build/pdf.mjs')).getDocument;
  const doc = await getDocument({
    data: new Uint8Array(pdfBytes),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  const pages = [];
  try {
    const total = Math.min(doc.numPages || 0, PDFJS_MAX_PAGES);
    for (let i = 1; i <= total; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const text = rebuildPageLines(tc.items).join('\n');
      page.cleanup?.();
      if (text.trim()) pages.push({ page_number: i, text: text.trim() });
    }
  } finally {
    await doc.destroy().catch(() => {});
  }
  return pages;
}

// 按 y 坐标聚类重建文本行（与 paper-distillation 的 rebuildLines 同思路：
// 表格行的数值列才能保持左右对齐，直接按 items 顺序拼接会串行）
function rebuildPageLines(items) {
  const rows = new Map();
  for (const it of items || []) {
    if (!it.str || !it.str.trim()) continue;
    const y = Math.round((it.transform ? it.transform[5] : 0) / 3) * 3; // 3pt 聚类容差
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(it);
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0]) // PDF 坐标系 y 向下递增 → 文本从上到下
    .map(([, its]) => its
      .sort((a, b) => (a.transform ? a.transform[4] : 0) - (b.transform ? a.transform[4] : 0))
      .map((i) => i.str)
      .join(' '));
}

// 带超时保护：Promise.race 超时即 reject，由上层记 attempts 后继续降级
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 统一返回通道结构（pdfjs 拿不到表格/参考文献/元信息，一律给空值，字段保持齐全）
async function runPdfjs(pdfBytes) {
  let blocks = [];
  try {
    const pages = await withTimeout(
      parsePdfViaPdfjsPages(pdfBytes),
      PDFJS_TIMEOUT_MS,
      'pdfjs 解析超时',
    );
    blocks = pages.map((p) => ({
      page_number: p.page_number,
      section_title: '',
      text: p.text,
      block_type: 'text',
    }));
  } catch (err) {
    // 逐页解析失败时退回 paper-distillation 里复用的扁平通道：保底能出文本，只是丢了页码
    logger.warn('document-parser', `逐页 pdfjs 解析失败，回退扁平 pdfjs 通道: ${err.message}`);
    const lines = await parsePdfViaPdfjs(pdfBytes);
    blocks = lines.map((text) => ({ page_number: null, section_title: '', text, block_type: 'text' }));
  }
  return {
    blocks,
    tables: [],
    metadata: { ...EMPTY_METADATA },
    references: [],
    citations: [],
    parser: 'pdfjs',
  };
}

// ===== MinerU 通道 =====
// MinerU 的 FastAPI 版接口：POST /file_parse（multipart，字段名 files），响应里的
// content_list 是带 page_idx（0 基）与 type 的结构化列表——页码与章节标题只能从这里拿。
// 响应形状按版本差异很大（results 可能是对象，也可能是以文件名为 key 的字典），做宽容解析。
function pickMinerUContent(data) {
  const results = data?.results;
  let markdown = data?.markdown || '';
  let contentList = data?.content_list || null;
  if (results && !Array.isArray(results)) {
    markdown = results.markdown || markdown;
    contentList = results.content_list || contentList;
    // 新版 MinerU 的 results 是以文件名为 key 的字典，逐个取第一个含 content_list 的值
    if (!contentList) {
      for (const value of Object.values(results)) {
        if (value && Array.isArray(value.content_list)) { contentList = value.content_list; break; }
      }
    }
    if (!markdown) {
      for (const value of Object.values(results)) {
        if (value && typeof value.markdown === 'string') { markdown = value.markdown; break; }
      }
    }
  }
  return { markdown: String(markdown || ''), contentList: Array.isArray(contentList) ? contentList : null };
}

// content_list 的 type → 统一 block_type
const MINERU_TYPE_MAP = {
  text: 'text',
  title: 'heading',
  list: 'list_item',
  equation: 'formula',
  interline_equation: 'formula',
  image: 'picture',
  table: 'table',
  table_footnote: 'caption',
  image_footnote: 'caption',
  page_footer: 'furniture',
  page_header: 'furniture',
};

// 表格/图片本体不进 blocks（表格进 tables，图片暂无人消费），只留它们的图注
const MINERU_SKIP_IN_BLOCKS = new Set(['table', 'picture', 'furniture']);

function mineruItemText(item) {
  if (item?.type === 'image' || item?.type === 'table') {
    const captions = item.image_caption || item.table_caption || item.caption || [];
    const captionText = Array.isArray(captions) ? captions.join(' ') : String(captions || '');
    return cleanText(captionText);
  }
  return cleanText(item?.text || item?.latex || item?.md_content || '');
}

// 从 MinerU 的 content_list 还原带页码与章节的文本块。
// 章节同样用「最近的上级标题」语义：按 title 项的 text_level（1 最大）维护栈。
function blocksFromMinerUContent(contentList) {
  const blocks = [];
  const stack = []; // [{ level, title }]
  for (const item of contentList) {
    if (!item || typeof item !== 'object') continue;
    const type = MINERU_TYPE_MAP[item.type] || 'text';
    const text = mineruItemText(item);
    const pageNumber = toInt(item.page_idx, -1) >= 0 ? item.page_idx + 1 : null; // MinerU 的 page_idx 是 0 基

    if (type === 'heading' && text) {
      // text_level 缺失时按 1 处理；值越小层级越高
      const level = Math.max(1, toInt(item.text_level, 1));
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title: text });
    }
    if (!text || MINERU_SKIP_IN_BLOCKS.has(type)) continue;
    if (blocks.length >= MAX_BLOCKS) break;
    blocks.push({
      page_number: pageNumber,
      section_title: stack.length > 0 ? stack[stack.length - 1].title : '',
      text,
      block_type: type,
    });
  }
  return blocks;
}

function tablesFromMinerUContent(contentList) {
  const tables = [];
  for (const item of contentList || []) {
    if (!item || item.type !== 'table') continue;
    const rows = htmlTableToRows(item.table_body);
    if (rows.length >= 2) tables.push(rows);
  }
  return tables;
}

function metadataFromMinerUContent(contentList) {
  for (const item of contentList || []) {
    if (item?.type === 'title' && cleanText(item.text)) {
      return { ...EMPTY_METADATA, title: cleanText(item.text) };
    }
  }
  return { ...EMPTY_METADATA };
}

async function runMinerU(pdfBytes) {
  const base = String(process.env.MINERU_API_URL || '').trim().replace(/\/+$/, '');
  const rawTimeout = Number(process.env.MINERU_TIMEOUT);
  const timeout = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 60_000;
  if (!base) throw new Error('未配置 MINERU_API_URL');

  const url = `${base}/file_parse`;
  // SSRF 防护：MinerU 是管理员自部署的内部服务，允许私网，但仍拦截回环/链路本地/云元数据
  await assertSafeAiResolvedUrl(url, { allowPrivate: true });

  const form = new FormData();
  form.append('files', new Blob([pdfBytes], { type: 'application/pdf' }), 'document.pdf');
  form.append('parse_method', 'auto');

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(timeout),
      redirect: 'manual',
    });
  } catch (err) {
    throw new Error(`MinerU 请求失败: ${err.message}`);
  }
  // 禁止跟随重定向：防止校验通过后被 3xx 带到内网/元数据端点
  if (resp.status >= 300 && resp.status < 400) throw new Error('MinerU 响应不允许重定向');
  if (!resp.ok) throw new Error(`MinerU HTTP ${resp.status}`);

  const { markdown, contentList } = pickMinerUContent(await resp.json());
  let blocks = [];
  let tables = [];
  let metadata = { ...EMPTY_METADATA };
  if (contentList) {
    blocks = blocksFromMinerUContent(contentList);
    tables = tablesFromMinerUContent(contentList);
    metadata = metadataFromMinerUContent(contentList);
  }
  // content_list 缺失（旧版本/降级）时退到 markdown，页码会丢（置 null）
  if (blocks.length === 0) blocks = blocksFromMarkdown(markdown);
  if (blocks.length === 0 && tables.length === 0) throw new Error('MinerU 响应缺少可解析内容');
  return { blocks, tables, markdown, metadata, references: [], citations: [], parser: 'mineru' };
}

// ===== 通道调度表 =====
// 每个 run 都必须：成功返回统一结构；失败一律 throw（不吞异常，交给上层记 attempts）
const CHANNELS = {
  mineru: { enabled: isMinerUEnabled, run: (bytes, opts) => runMinerU(bytes, opts) },
  docling: {
    enabled: isDoclingEnabled,
    // wantTables=false 时用 fast 模式省时间（accurate 模式的表格结构模型明显更慢）
    run: (bytes, opts) => parsePdfViaDocling(bytes, {
      filename: opts.filename,
      tableMode: opts.wantTables === false ? 'fast' : 'accurate',
    }),
  },
  grobid: { enabled: isGrobidEnabled, run: (bytes) => parsePdfViaGrobid(bytes) },
  pdfjs: { enabled: () => true, run: (bytes) => runPdfjs(bytes) },
};

// 语言驱动的默认优先级：
//   中文复杂版式/扫描件 → MinerU 更稳（对双栏、竖排、扫描 OCR 支持更好）
//   英文与通用学术 PDF → Docling 更稳（布局/阅读顺序/表格结构识别更准）
// GROBID 排在 pdfjs 之前：它至少能给出页码、章节与参考文献，结构化信息优于纯文本
function defaultOrder(lang) {
  return lang === 'zh'
    ? ['mineru', 'docling', 'grobid', 'pdfjs']
    : ['docling', 'mineru', 'grobid', 'pdfjs'];
}

// DOC_PARSER_PREFER 让运维强制指定首选通道（排到最前，其余保持语言默认顺序）
export function resolveParserOrder(lang, prefer) {
  const base = defaultOrder(lang);
  const p = String(prefer || '').trim().toLowerCase();
  if (!base.includes(p)) return base;
  return [p, ...base.filter((x) => x !== p)];
}

// 语言嗅探：只读前 2 页，失败就当英文（不影响主流程）。
// 仅在「启用中的非 pdfjs 通道 ≥ 2 个」时才真的去解析——只有一个通道时顺序无所谓，
// 没必要为此多跑一遍 pdfjs。
async function resolveLanguage(pdfBytes, enabledChannels, languageHint) {
  const hint = normalizeLanguageHint(languageHint);
  if (hint) return hint;
  const structural = enabledChannels.filter((name) => name !== 'pdfjs');
  if (structural.length < 2) return 'en';
  try {
    const getDocument = (await import('pdfjs-dist/legacy/build/pdf.mjs')).getDocument;
    const doc = await getDocument({
      data: new Uint8Array(pdfBytes),
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
    let sample = '';
    try {
      const total = Math.min(doc.numPages || 0, LANGUAGE_PROBE_PAGES);
      for (let i = 1; i <= total; i++) {
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        sample += tc.items.map((it) => it.str || '').join(' ');
        page.cleanup?.();
      }
    } finally {
      await doc.destroy().catch(() => {});
    }
    return detectLanguage(sample);
  } catch (err) {
    logger.warn('document-parser', `语言嗅探失败，按英文处理: ${err.message}`);
    return 'en';
  }
}

// 合并两个 metadata：以主通道为准，空白处用备选通道补齐
function mergeMetadata(primary, secondary) {
  const out = { ...EMPTY_METADATA, ...(primary || {}) };
  if (!secondary) return out;
  if (!out.title) out.title = secondary.title || '';
  if (!out.doi) out.doi = secondary.doi || '';
  if (!out.year) out.year = secondary.year || '';
  if (!out.abstract) out.abstract = secondary.abstract || '';
  if (!out.journal) out.journal = secondary.journal || '';
  if (!(out.authors && out.authors.length > 0)) out.authors = secondary.authors || [];
  return out;
}

/**
 * 统一解析入口：按优先级依次尝试各通道，第一个产出非空 blocks 的通道胜出
 * @param {Buffer|Uint8Array} pdfBytes PDF 字节
 * @param {object} [options]
 * @param {string} [options.filename] 文件名（传给 Docling 便于其按扩展名选后端）
 * @param {string} [options.languageHint] 语言提示（'zh'/'en'），省略时自动嗅探前 2 页
 * @param {boolean} [options.wantReferences] 是否需要参考文献/文内引用（会额外跑一次 GROBID）
 * @param {boolean} [options.wantTables] 是否需要表格（false 时 Docling 用 fast 表格模式省时间）
 * @param {string[]} [options.parsers] 测试注入：显式指定通道顺序（仍按是否配置过滤）
 * @returns {Promise<{ parser, blocks, tables, metadata, references, citations, degraded, attempts, language }>}
 * @throws 所有通道都失败时抛出带 attempts 的 Error
 */
export async function parseDocument(pdfBytes, options = {}) {
  const {
    filename = '',
    languageHint = '',
    wantReferences = false,
    wantTables = true,
    parsers = null,
  } = options || {};

  if (!pdfBytes || pdfBytes.length === 0) throw new Error('PDF 内容为空');

  // 通道顺序：测试可显式注入 parsers；否则由语言 + DOC_PARSER_PREFER 决定
  const configured = Object.keys(CHANNELS).filter((name) => CHANNELS[name].enabled());
  const candidates = Array.isArray(parsers) && parsers.length > 0
    ? parsers.map((p) => String(p).toLowerCase()).filter((p) => CHANNELS[p])
    : resolveParserOrder(
      await resolveLanguage(pdfBytes, configured, languageHint),
      process.env.DOC_PARSER_PREFER,
    );

  const attempts = [];
  const enabledSet = new Set(configured);

  // GROBID 调用收敛成**单个可共享的 promise**：
  //  - wantReferences=true 时提前发起，与主通道真正并行（而不是等主通道跑完再串行补一次）；
  //  - 主通道链若也轮到 grobid，复用同一个 promise，不会重复跑一遍；
  //  - 主流程失败时也不会漏掉 rejection（这里已把异常收敛成 { ok:false }）。
  let grobidPromise = null;
  const ensureGrobid = () => {
    if (!grobidPromise) {
      grobidPromise = parsePdfViaGrobid(pdfBytes).then(
        (result) => ({ ok: true, result }),
        (err) => ({ ok: false, error: err.message || String(err) }),
      );
    }
    return grobidPromise;
  };
  if (wantReferences && enabledSet.has('grobid')) ensureGrobid();

  let winner = null;
  let winnerName = '';
  for (const name of candidates) {
    if (!enabledSet.has(name)) {
      // 未配置的插件通道：静默跳过，但要在 attempts 里留痕（前端/日志要能看到为什么没走）
      attempts.push({ parser: name, ok: false, skipped: true, error: MISSING_ENV_HINT[name] || '未配置，跳过该通道' });
      continue;
    }
    try {
      let result;
      if (name === 'grobid') {
        // 复用（可能是提前发起的）那一次 GROBID 调用
        const g = await ensureGrobid();
        if (!g.ok) throw new Error(g.error);
        result = g.result;
      } else {
        result = await CHANNELS[name].run(pdfBytes, { filename, wantTables });
      }
      if (!result || !Array.isArray(result.blocks) || result.blocks.length === 0) {
        throw new Error('返回空的文本块');
      }
      attempts.push({ parser: name, ok: true, error: '' });
      winner = result;
      winnerName = name;
      logger.info('document-parser', `解析通道 ${name} 成功（${result.blocks.length} 块 / ${filename || ''}）`);
      break;
    } catch (err) {
      attempts.push({ parser: name, ok: false, error: err.message || String(err) });
      logger.warn('document-parser', `解析通道 ${name} 失败，降级到下一通道: ${err.message}`);
    }
  }

  if (!winner) {
    const error = new Error(`全部解析通道均失败：${attempts.map((a) => `${a.parser}(${a.error})`).join(' → ')}`);
    error.attempts = attempts;
    throw error;
  }

  // 启用的通道里，胜出通道不是第一个 → 说明发生过降级
  const enabledOrder = candidates.filter((name) => enabledSet.has(name));
  const degraded = enabledOrder.indexOf(winnerName) > 0 || winnerName === 'pdfjs';

  let references = Array.isArray(winner.references) ? winner.references : [];
  let citations = Array.isArray(winner.citations) ? winner.citations : [];
  let metadata = mergeMetadata(winner.metadata);

  // 主通道就是 GROBID 时，references/citations 已在主结果里，无需再合并一次
  if (grobidPromise && winnerName !== 'grobid') {
    const extra = await grobidPromise;
    if (extra.ok) {
      attempts.push({ parser: 'grobid', ok: true, error: '', role: 'references' });
      // 主通道没给出参考文献/引用时，用 GROBID 的补齐；GROBID 失败不影响主结果
      if (references.length === 0) references = extra.result.references || [];
      if (citations.length === 0) citations = extra.result.citations || [];
      metadata = mergeMetadata(metadata, extra.result.metadata);
    } else {
      attempts.push({ parser: 'grobid', ok: false, error: extra.error, role: 'references' });
      logger.warn('document-parser', `GROBID 参考文献补充失败（忽略）: ${extra.error}`);
    }
  }

  return {
    parser: winnerName,
    blocks: winner.blocks.slice(0, MAX_BLOCKS),
    tables: Array.isArray(winner.tables) ? winner.tables : [],
    metadata,
    references,
    citations,
    degraded,
    attempts,
  };
}

/**
 * 把 blocks 转成证据库可直接消费的来源列表（字段名与 evidence_chunks 对齐）
 * 无 section_title 的块回落到 metadata.title，保证溯源时至少能看到来源文档标题
 * @param {Array} blocks
 * @param {{ title?: string }} [metadata]
 * @returns {Array<{ page_number: number|null, section_title: string, text: string }>}
 */
export function blocksToEvidenceSources(blocks, metadata) {
  const fallbackTitle = String(metadata?.title || '').trim();
  const out = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    const text = cleanText(block?.text);
    if (!text) continue;
    out.push({
      page_number: block?.page_number ?? null,
      section_title: String(block?.section_title || '').trim() || fallbackTitle,
      text,
    });
  }
  return out;
}

/**
 * 解析质量分（0-100），用于日志与后续质量评测
 * 评分构成：页码覆盖 30 + 章节覆盖 20 + 表格 15 + 参考文献 15 + 引用 10 + 标题 10，降级通道 -20
 * @param {object} result parseDocument 的返回值
 * @returns {number} 0-100 的整数
 */
export function estimateParseQuality(result) {
  if (!result || typeof result !== 'object') return 0;
  const blocks = Array.isArray(result.blocks) ? result.blocks : [];
  const total = blocks.length;
  const ratio = (predicate) => (total > 0 ? blocks.filter(predicate).length / total : 0);

  let score = 0;
  score += 30 * ratio((b) => b?.page_number != null && Number(b.page_number) > 0);
  score += 20 * ratio((b) => String(b?.section_title || '').trim() !== '');
  if (Array.isArray(result.tables) && result.tables.length > 0) score += 15;
  if (Array.isArray(result.references) && result.references.length > 0) score += 15;
  if (Array.isArray(result.citations) && result.citations.length > 0) score += 10;
  if (String(result?.metadata?.title || '').trim()) score += 10;
  if (result.degraded) score -= 20; // 走过降级链说明首选通道不可用，质量预期下调

  return Math.max(0, Math.min(100, Math.round(score)));
}

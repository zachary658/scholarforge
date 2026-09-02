// Docling 解析通道（可选插件）
//
// Docling 是 MIT 协议的学术文档解析库，擅长页面布局分析、阅读顺序还原、表格结构
// 识别、公式与图片抽取，输出统一的 DoclingDocument JSON / Markdown。
// 本模块通过 docling-serve（官方 HTTP 服务）调用它，未配置 DOCLING_API_URL 时
// 整个通道静默跳过，绝不阻断主流程。
//
// 官方契约依据（写代码前已核实，勿凭记忆改字段名）：
//   1. docling-serve 用法文档
//      https://raw.githubusercontent.com/docling-project/docling-serve/main/docs/usage.md
//      - 端点：POST /v1/convert/file（multipart，文件字段名固定为 files；旧版本为 /v1alpha/convert/file）
//      - 选项字段与 ConvertDocumentsOptions 同名：to_formats / do_ocr / table_mode / pdf_backend ...
//      - 响应信封：{ document: { md_content, json_content, html_content, text_content, doctags_content },
//                    status: success|partial_success|skipped|failure, processing_time, timings, errors }
//      - 鉴权：服务端配置 DOCLING_SERVE_API_KEY 时请求需带 X-Api-Key 头
//   2. DoclingDocument JSON 结构（json_content 的内部结构）
//      https://github.com/docling-project/docling-core/blob/main/docling_core/types/doc/items/table/table_data.py
//      https://docling-project.github.io/docling/concepts/docling_document/
//      - 顶层：schema_name/version/name/origin/body/groups/texts/pictures/tables/pages
//      - text 项：self_ref、label、text、orig、level、prov、parent、children、content_layer
//      - prov 项：{ page_no, bbox: { l, t, r, b, coord_origin }, charspan: [start, end] }
//      - table 项：{ self_ref, label, prov, captions, data: { table_cells, num_rows, num_cols, grid } }
//      - TableCell：{ text, row_span, col_span, start_row_offset_idx, end_row_offset_idx,
//                     start_col_offset_idx, end_col_offset_idx, column_header, row_header, bbox }
//      - grid 是 @computed_field（num_rows x num_cols 二维数组）；跨行/跨列的单元格会在
//        其覆盖的每个格子里重复出现——这是 docling-core 的既有语义，下面从 table_cells
//        重建网格时也刻意保持同样语义，保证两条路径输出一致。
//
// 设计原则：
//   - 所有失败一律 throw，由上层 document-parser 负责降级，本模块不做兜底；
//   - 字段解析全宽容（不同 docling 版本字段有差异），取不到就退化到 Markdown；
//   - 环境变量在调用时读取而非模块加载时固化，便于测试用 env 打桩。
import { assertSafeAiResolvedUrl } from '../utils.js';
import logger from '../logger.js';

const DEFAULT_TIMEOUT_MS = 120000;
const MAX_TIMEOUT_MS = 600000;

// 新版本 docling-serve 用 /v1，0.5.x 等旧版本只有 /v1alpha。
// 先试 /v1，只有确属「路径不存在」（404/405）时才换 /v1alpha 重试，
// 其余错误（超时、500、鉴权失败）直接抛出让上层降级，避免无意义重试。
const CONVERT_PATHS = ['/v1/convert/file', '/v1alpha/convert/file'];

// 读取顺序优先级：正文 > 版式家具（页眉页脚）
const FURNITURE_LABELS = new Set(['page_header', 'page_footer', 'page_number']);

// label → 统一 block_type（未列出的统一归为 text）
const LABEL_TO_BLOCK_TYPE = {
  title: 'title',
  section_header: 'heading',
  list_item: 'list_item',
  caption: 'caption',
  formula: 'formula',
  code: 'code',
  table: 'table',
  picture: 'picture',
};

// 单文档最多保留的文本块数（防止超大 PDF 撑爆下游证据库；超出部分按阅读顺序截断）
const MAX_BLOCKS = 4000;

// body 树的递归深度上限：防御性约束，避免异常嵌套（或自引用）导致栈溢出
const MAX_TREE_DEPTH = 32;

function readConfig() {
  const base = String(process.env.DOCLING_API_URL || '').trim().replace(/\/+$/, '');
  const rawTimeout = Number(process.env.DOCLING_TIMEOUT_MS);
  const timeout = Number.isFinite(rawTimeout) && rawTimeout > 0
    ? Math.min(rawTimeout, MAX_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS;
  const apiKey = String(process.env.DOCLING_API_KEY || '').trim();
  return { base, timeout, apiKey };
}

// 是否配置了 Docling 服务（未配置时上层直接跳过该通道，不发任何网络请求）
export function isDoclingConfigured() {
  return Boolean(readConfig().base);
}

function cleanText(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function cellText(cell) {
  if (cell == null) return '';
  if (typeof cell === 'string') return cleanText(cell);
  return cleanText(cell.text);
}

// 把 #/texts/22 形式的 JSON 指针解析为 DoclingDocument 里的实际节点
function resolveRef(doc, ref) {
  const refStr = typeof ref === 'string' ? ref : (ref?.$ref || ref?.cref);
  if (typeof refStr !== 'string') return null;
  const parts = refStr.replace(/^#\/?/, '').split('/');
  if (parts.length < 2) return null;
  const [collection, indexStr] = parts;
  const index = Number(indexStr);
  if (!Number.isInteger(index) || index < 0) return null;
  const bucket = doc?.[collection];
  return Array.isArray(bucket) ? bucket[index] ?? null : null;
}

// 表格 → 二维数组。
// 优先用 table_cells + num_rows/num_cols 自重建（能拿到 span 信息，且各版本字段最稳定）；
// 拿不到再退回官方计算字段 data.grid；两者语义一致（跨行跨列单元格在覆盖范围内重复出现）。
function tableToRows(table) {
  const data = table?.data;
  if (!data) return [];

  const cells = Array.isArray(data.table_cells) ? data.table_cells : [];
  let numRows = toInt(data.num_rows, 0);
  let numCols = toInt(data.num_cols, 0);

  if (cells.length > 0) {
    // num_rows/num_cols 偶有缺失（旧版本或解析降级），用单元格偏移补算
    if (numRows <= 0) numRows = cells.reduce((m, c) => Math.max(m, toInt(c?.end_row_offset_idx, 0)), 0);
    if (numCols <= 0) numCols = cells.reduce((m, c) => Math.max(m, c?.end_col_offset_idx, 0), 0);
    if (numRows > 0 && numCols > 0) {
      const grid = Array.from({ length: numRows }, () => Array(numCols).fill(''));
      for (const cell of cells) {
        const text = cellText(cell);
        const r0 = Math.max(0, toInt(cell?.start_row_offset_idx, 0));
        const r1 = Math.min(numRows, Math.max(r0 + 1, toInt(cell?.end_row_offset_idx, r0 + 1)));
        const c0 = Math.max(0, toInt(cell?.start_col_offset_idx, 0));
        const c1 = Math.min(numCols, Math.max(c0 + 1, toInt(cell?.end_col_offset_idx, c0 + 1)));
        for (let r = r0; r < r1; r++) {
          for (let c = c0; c < c1; c++) grid[r][c] = text;
        }
      }
      return grid.filter((row) => row.some((v) => v !== ''));
    }
  }

  if (Array.isArray(data.grid) && data.grid.length > 0) {
    const grid = data.grid
      .filter((row) => Array.isArray(row))
      .map((row) => row.map(cellText));
    return grid.filter((row) => row.some((v) => v !== ''));
  }

  return [];
}

// 从 Markdown 里兜底抽表格：先认 HTML <table>，再认 Markdown 管道表
// （docling 未返回 json_content、或表格结构识别被关闭时会走到这里）
export function markdownTablesToRows(markdown) {
  const rows = [];
  const text = String(markdown || '');
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(text)) !== null) {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((c) => c[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
    if (cells.length > 0) rows.push(cells);
  }
  if (rows.length >= 2) return rows;

  const pipeRows = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^\|.*\|$/.test(line) && line.includes('|')) {
      const cells = line.slice(1, -1).split('|').map((c) => c.trim());
      if (/^:?-{2,}:?$/.test(cells[0] || '')) continue; // 分隔行 |---|---|
      if (current) pipeRows.push(current);
      current = cells;
    } else if (current) {
      pipeRows.push(current);
      current = null;
    }
  }
  if (current) pipeRows.push(current);
  return pipeRows.length >= 2 ? pipeRows : [];
}

// 取区块所在页码：prov 是一个数组（一个块可能跨页），取首个有值的页码
function pageNoOf(item) {
  const prov = item?.prov;
  if (Array.isArray(prov)) {
    for (const p of prov) {
      const n = toInt(p?.page_no, 0);
      if (n > 0) return n;
    }
  }
  const direct = toInt(item?.page_no, 0);
  return direct > 0 ? direct : null;
}

function blockTypeOf(item) {
  const label = String(item?.label || '');
  return LABEL_TO_BLOCK_TYPE[label] || 'text';
}

// 判断是否属于「版式家具」（页眉/页脚/页码）：这类内容对证据库是噪声，直接丢弃
function isFurniture(item) {
  return item?.content_layer === 'furniture' || FURNITURE_LABELS.has(String(item?.label || ''));
}

// 表格/图片本身不进 blocks（表格内容已单独进 tables，图片暂无人消费），
// 只保留它们的图注文本，避免 blocks 里出现空壳条目
function isSkippableInBlocks(type) {
  return type === 'table' || type === 'picture';
}

// 按阅读顺序遍历 body 树，产出带页码与章节标题的文本块。
// 章节标题用「最近的上级标题」语义：遇到 section_header/title 就刷新当前章节游标，
// 并按 level 维护栈，保证从深章节回到浅章节时能正确回退。
// 这里不依赖 groups/parent 的层级结构（各版本差异大），只依赖 body.children 的
// 阅读顺序 + label/level——docling 的核心卖点正是「阅读顺序而非页面顺序」。
function collectBlocks(doc) {
  const bodyChildren = doc?.body?.children;
  // body 缺失时退化为按 texts 数组顺序输出（页码/章节信息会缺失，但至少不丢内容）
  const roots = Array.isArray(bodyChildren) && bodyChildren.length > 0
    ? bodyChildren
    : (Array.isArray(doc?.texts) ? doc.texts.map((t) => ({ $ref: t?.self_ref })) : []);

  const blocks = [];
  // 章节栈：[{ level, title }]
  const stack = [];

  const pushBlock = (item) => {
    if (blocks.length >= MAX_BLOCKS) return;
    const type = blockTypeOf(item);
    const text = cleanText(item.text ?? item.orig);
    if (!text) return;
    blocks.push({
      page_number: pageNoOf(item),
      section_title: stack.length > 0 ? stack[stack.length - 1].title : '',
      text,
      block_type: type,
    });
  };

  const visit = (nodes, depth) => {
    if (depth > MAX_TREE_DEPTH) return;
    for (const node of nodes || []) {
      const item = resolveRef(doc, node?.$ref || node?.cref || node);
      if (!item || isFurniture(item)) continue;

      const type = blockTypeOf(item);
      if (type === 'heading' || type === 'title') {
        const title = cleanText(item.text ?? item.orig);
        const level = Math.max(1, toInt(item.level, type === 'title' ? 0 : 1));
        // 弹掉层级 >= 当前标题的旧章节，保证栈顶始终是「最近的上级标题」
        while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
        if (title) stack.push({ level, title });
        pushBlock(item);
      } else if (!isSkippableInBlocks(type)) {
        pushBlock(item);
      }

      // 容器型节点（list / section / inline 组）继续向下递归
      const kids = item.children;
      if (Array.isArray(kids) && kids.length > 0) visit(kids, depth + 1);
    }
  };

  visit(roots, 0);
  return blocks;
}

// Markdown 兜底分块：json_content 缺失（只请求了 md 格式、或旧版本未返回）时使用。
// 页码无法获得（置 null），章节标题从 # 标题行推断。
// 导出以便 document-parser 在 MinerU 也只返回 markdown 时复用同一套分块规则。
export function blocksFromMarkdown(markdown) {
  const blocks = [];
  let section = '';
  let paragraph = [];
  const flush = () => {
    const text = cleanText(paragraph.join(' '));
    paragraph = [];
    if (!text || blocks.length >= MAX_BLOCKS) return;
    blocks.push({ page_number: null, section_title: section, text, block_type: 'text' });
  };
  for (const raw of String(markdown || '').split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      section = cleanText(heading[2]);
      continue;
    }
    if (/^(?:[-*+]|\d+[.)])\s+/.test(line) || /^\|.*\|$/.test(line) || /^\s*$/.test(line)) {
      // 列表项与表格行各自成块，避免与正文混在一起破坏证据粒度
      flush();
      paragraph = [line.replace(/^(?:[-*+]|\d+[.)])\s+/, '')];
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

// 从 DoclingDocument JSON 提取标题/作者/DOI 等元信息（拿不到就留空，不报错）
function metadataFromDocling(doc) {
  const texts = Array.isArray(doc?.texts) ? doc.texts : [];
  let title = '';
  for (const t of texts) {
    if (String(t?.label) === 'title' && cleanText(t.text)) { title = cleanText(t.text); break; }
  }
  const name = cleanText(doc?.name);
  return {
    title: title || (name && name !== 'document' ? name : ''),
    authors: [],
    doi: '',
    year: '',
    abstract: '',
    journal: '',
  };
}

// 纯函数：把 DoclingDocument JSON（+ 可选 Markdown）解析为统一结构，便于单测
export function parseDoclingDocument(jsonContent, markdown = '') {
  const md = String(markdown || '');
  const doc = jsonContent && typeof jsonContent === 'object' ? jsonContent : null;

  let blocks = [];
  let tables = [];
  let metadata = { title: '', authors: [], doi: '', year: '', abstract: '', journal: '' };

  if (doc) {
    blocks = collectBlocks(doc);
    metadata = metadataFromDocling(doc);
    for (const table of Array.isArray(doc.tables) ? doc.tables : []) {
      const rows = tableToRows(table);
      if (rows.length >= 2) tables.push(rows);
    }
  }

  // json 通道没拿到东西时，用 Markdown 兜底（docling 的 md 输出本身已按阅读顺序组织）
  if (blocks.length === 0) blocks = blocksFromMarkdown(md);
  if (tables.length === 0) tables = markdownTablesToRows(md);

  return { blocks, tables, markdown: md, metadata };
}

async function postConvert(baseUrl, pdfBytes, filename, timeout, apiKey, tableMode) {
  const form = new FormData();
  const name = String(filename || 'document.pdf');
  form.append('files', new Blob([pdfBytes], { type: 'application/pdf' }), name);
  // to_formats 同时要 md 与 json：md 用于兜底与人工核对，json 用于页码/章节/表格结构。
  // 兼容两种参数风格：新版读重复的 to_formats 字段，0.5.x 的示例里也接受同名表单字段。
  form.append('to_formats', 'md');
  form.append('to_formats', 'json');
  form.append('table_mode', tableMode === 'fast' ? 'fast' : 'accurate');
  form.append('do_ocr', 'true');
  form.append('abort_on_error', 'false');

  const headers = {};
  if (apiKey) headers['X-Api-Key'] = apiKey;

  let lastError = null;
  for (let i = 0; i < CONVERT_PATHS.length; i++) {
    const url = `${baseUrl}${CONVERT_PATHS[i]}`;
    // SSRF 防护：Docling 是管理员自部署的内部服务，允许私网地址，但仍需
    // 拦截回环/链路本地/云元数据端点，且每次请求前都要重新校验（DNS 可能变化）
    await assertSafeAiResolvedUrl(url, { allowPrivate: true });
    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        body: form,
        headers,
        signal: AbortSignal.timeout(timeout),
        redirect: 'manual',
      });
    } catch (err) {
      lastError = new Error(`Docling 请求失败: ${err.message}`);
      continue;
    }
    // 禁止跟随重定向：防止校验通过后被 3xx 带到内网/元数据端点
    if (resp.status >= 300 && resp.status < 400) {
      lastError = new Error('Docling 响应不允许重定向');
      continue;
    }
    // 只有「路径不存在」才换旧版路径重试；其它状态码（500/401/503）重试无意义
    if (!resp.ok && resp.status !== 404 && resp.status !== 405) {
      throw new Error(`Docling HTTP ${resp.status}`);
    }
    if (resp.status === 404 || resp.status === 405) {
      lastError = new Error(`Docling HTTP ${resp.status}`);
      continue;
    }
    return await resp.json();
  }
  throw lastError || new Error('Docling 服务不可用');
}

// 宽容取出 json_content / md_content（不同版本字段位置不同）
function pickContent(payload) {
  const docNode = payload?.document ?? payload?.documents?.[0] ?? payload ?? {};
  const jsonContent = docNode?.json_content ?? docNode?.content?.json ?? payload?.json_content ?? null;
  const markdown = docNode?.md_content ?? docNode?.content?.md ?? payload?.md_content ?? '';
  return { jsonContent, markdown: String(markdown || '') };
}

/**
 * 调用 Docling 解析 PDF
 * @param {Buffer|Uint8Array} pdfBytes PDF 字节
 * @param {{ filename?: string, tableMode?: 'fast'|'accurate' }} [options]
 *        tableMode 由上层 parseDocument 的 wantTables 决定：调用方不需要表格时用 fast 省时间
 * @returns {Promise<{ blocks: Array, tables: Array, markdown: string, metadata: object, parser: 'docling' }>}
 * @throws 任何失败都抛出，由上层统一降级
 */
export async function parsePdfViaDocling(pdfBytes, { filename, tableMode } = {}) {
  const { base, timeout, apiKey } = readConfig();
  if (!base) throw new Error('未配置 DOCLING_API_URL');
  if (!pdfBytes || pdfBytes.length === 0) throw new Error('PDF 内容为空');

  const payload = await postConvert(base, pdfBytes, filename, timeout, apiKey, tableMode);

  // status=failure 表示服务端确实处理失败（HTTP 200 也可能带失败状态），必须按失败处理
  const status = String(payload?.status || '').toLowerCase();
  if (status === 'failure') {
    const firstError = Array.isArray(payload?.errors) && payload.errors.length > 0
      ? String(payload.errors[0]?.error_message || payload.errors[0] || '')
      : '';
    throw new Error(`Docling 转换失败: ${firstError || 'status=failure'}`);
  }

  const { jsonContent, markdown } = pickContent(payload);
  const { blocks, tables, metadata } = parseDoclingDocument(jsonContent, markdown);
  if (blocks.length === 0 && tables.length === 0) {
    throw new Error('Docling 响应缺少可解析内容');
  }
  if (status === 'partial_success') {
    logger.warn('docling-client', `Docling 返回 partial_success，内容可能不完整: ${filename || ''}`);
  }
  return { blocks, tables, markdown, metadata, parser: 'docling' };
}

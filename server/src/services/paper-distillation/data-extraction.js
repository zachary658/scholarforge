/**
 * 数据提取（数据套用引擎）：
 *   - 摘要文本正则提取性能指标（准确率、F1、IoU、Dice）
 *   - OA 全文 PDF 下载（SSRF 防护 + 大小/超时限制）与解析（document-parser 四通道路由）
 *   - 结构化表格提取（MinerU content_list / pdfjs 重建行数值对齐）
 * 从 paper-distillation.js 拆出。
 */
// 出站 PDF 下载并发上限：防止大量并发外站请求拖垮出网带宽 / 触发目标站限流（L-3）
import { assertSafeAiResolvedUrl, createSemaphore } from '../../utils.js';
import logger from '../../logger.js';
// 学术文档统一解析层：extractPdfText 改走它的四通道路由（含 MinerU 通道），
// 原先的「MinerU → pdfjs」两通道判断由它统一负责
import { parseDocument } from '../document-parser.js';

const pdfDownloadSem = createSemaphore(Number(process.env.PDF_MAX_CONCURRENCY) || 5);

// pdfjs 动态导入（Node 18+ 兼容）；仅在需要解析 OA PDF 时加载，避免拖慢常规路径
async function loadPdfjs() {
  const mod = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return mod.getDocument;
}

// ===== 指标提取 =====
// 常见性能指标匹配模式（摘要与 PDF 全文共用）
const METRIC_PATTERNS = [
  { regex: /(?:accuracy|ACC)\s*(?:of|=|:|达到)?\s*(\d+\.?\d*)\s*%/gi, label: '准确率' },
  // 兼容 "Dice coefficient of 88%" / "Dice系数 0.88" / "DSC: 0.88" 等写法
  { regex: /(?:dice|DSC|DICE)\s*(?:coefficient)?\s*(?:of|=|:|达到|系数)?\s*(\d+\.?\d*)\s*%?/gi, label: 'Dice' },
  { regex: /(?:iou|IoU|IOU)\s*(?:of|=|:|达到)?\s*(\d+\.?\d*)/gi, label: 'IoU' },
  // 兼容 "F1-score of 0.91" 与 "F1 score of 0.91" 两种写法
  { regex: /(?:f1|F1-score)\s*(?:score)?\s*(?:of|=|:|达到)?\s*(\d+\.?\d*)/gi, label: 'F1' },
];

// 从一段文本中提取指标（返回 [{label, value}]，value 已归一化为 0-100 或原始比例）
export function extractMetricsFromText(text) {
  const metrics = [];
  for (const { regex, label } of METRIC_PATTERNS) {
    const matches = [...String(text || '').matchAll(regex)];
    for (const m of matches) {
      const val = parseFloat(m[1]);
      if (val > 0 && val <= 100) {
        metrics.push({ label, value: val > 1 ? val : val * 100 });
      }
    }
  }
  return metrics;
}

// 从摘要中提取性能指标（准确率、F1、IoU等），用于生成对比图表
export function extractBenchmarkData(papers) {
  const benchmarks = [];
  for (const p of papers) {
    const text = p.abstract || '';
    if (!text) continue;
    const metrics = extractMetricsFromText(text);
    if (metrics.length > 0) {
      benchmarks.push({
        paperTitle: p.title,
        paperYear: p.year,
        source_db: p.source_db,
        source_url: p.source_url,
        metrics,
      });
    }
  }
  return benchmarks;
}

// ===== OA PDF 全文数据提取（数据套用引擎第二阶段） =====
// 双通道设计：
//   1. MinerU（优先，MINERU_API_URL 配置后启用）：表格/公式/双栏解析质量远高于纯文本提取，
//      适合"图表数据套用"的高质量场景（https://github.com/opendatalab/MinerU）
//   2. 内置 pdfjs（兜底）：轻量、零部署依赖，按坐标重建文本行
// 限制：PDF ≤ 5MB、最多解析前 15 页、每篇超时、每次任务最多处理 4 篇、并发 3
const PDF_MAX_BYTES = 5 * 1024 * 1024;
const PDF_MAX_PAGES = 15;
const PDF_MAX_PAPERS = 4;
const PDF_CONCURRENCY = 3;
// pdfjs 解析超时（毫秒）：损坏/构造特殊的 PDF 可能让解析长期挂起，拖死请求与任务
const PDFJS_TIMEOUT_MS = 60_000;
const MINERU_API_URL = (process.env.MINERU_API_URL || '').replace(/\/+$/, '');

// 按 y 坐标聚类重建 PDF 文本行（表格行的数值列才能保持对齐）
function rebuildLines(items) {
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
      .sort((a, b) => (a.transform ? a.transform[4] : 0) - (b.transform ? b.transform[4] : 0))
      .map((i) => i.str)
      .join(' '));
}

// 下载 OA PDF（SSRF 防护 + 大小限制 + 超时；失败抛错由调用方降级）
// 安全：所有外站 URL 先经 assertSafeAiResolvedUrl 校验，拒绝回环/链路本地/云元数据/私网；
// 并禁止重定向（redirect:'manual'）以防攻击者在校验后通过 3xx 跳转到内网/元数据端点。
export async function downloadPdfBytes(url) {
  await assertSafeAiResolvedUrl(url, { allowPrivate: false });
  const resp = await pdfDownloadSem.run(() => fetch(url, {
    headers: { 'User-Agent': 'ScholarForge/1.0 (mailto:scholarforge@test.com)' },
    signal: AbortSignal.timeout(10000),
    redirect: 'manual',
  }));
  // 禁止自动跟随重定向：避免通过 3xx 绕过防护跳转到内网/元数据端点
  if (resp.status >= 300 && resp.status < 400) {
    throw new Error('PDF 下载不允许重定向');
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const declared = Number(resp.headers.get('content-length') || 0);
  if (declared && declared > PDF_MAX_BYTES) throw new Error('PDF 超过 5MB 上限');
  if (!declared) {
    // content-length 缺失时流式读取累计字节数：超 5MB 立即 cancel 中断下载，
    // 不能等 arrayBuffer() 全量缓冲完再检查（那时内存已被无上限的响应体撑爆）
    const reader = resp.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > PDF_MAX_BYTES) throw new Error('PDF 超过 5MB 上限');
        chunks.push(Buffer.from(value));
      }
    } finally {
      // 成功路径流已读完，cancel 为幂等空操作；超时/超限路径借此中断连接释放带宽
      reader.cancel().catch(() => {});
    }
    return Buffer.concat(chunks);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length > PDF_MAX_BYTES) throw new Error('PDF 超过 5MB 上限');
  return buf;
}

// 从 MinerU 响应的 content_list 中提取结构化表格（table_body 为 HTML 表格）
// 注：MinerU 通道的 PDF 解析已统一收敛到 document-parser.js 的 extractPdfText 四通道路由，
// 此处仅保留结构化表格提取，供 document-parser 复用（见其文件头注释）。
export function tablesFromMinerUData(data) {
  const contentList = data?.results?.content_list || data?.content_list || [];
  const tables = [];
  for (const item of contentList) {
    if (item && item.type === 'table' && item.table_body) {
      const rows = htmlTableToRows(item.table_body);
      if (rows.length >= 2) tables.push(rows);
    }
  }
  return tables;
}

// HTML 表格 → 二维数组（宽容解析：单元格内标签剥离）
export function htmlTableToRows(html) {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(String(html || ''))) !== null) {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((c) => c[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

// ===== 通道二：内置 pdfjs（兜底） =====
// 对外统一带超时保护：Promise.race 60 秒超时即 reject（由调用方降级处理），
// 损坏 PDF 曾可能令解析无限挂起，拖死请求/任务（含资料上传解析路径）
export function parsePdfViaPdfjs(pdfBytes) {
  const timeout = new Promise((_, reject) => {
    const t = setTimeout(() => reject(new Error('PDF 解析超时')), PDFJS_TIMEOUT_MS);
    t.unref?.(); // 超时定时器不阻塞进程退出
  });
  return Promise.race([parsePdfViaPdfjsCore(pdfBytes), timeout]);
}

async function parsePdfViaPdfjsCore(pdfBytes) {
  const getDocument = await loadPdfjs();
  const doc = await getDocument({ data: new Uint8Array(pdfBytes), isEvalSupported: false, useSystemFonts: true }).promise;
  const lines = [];
  try {
    for (let i = 1; i <= Math.min(doc.numPages, PDF_MAX_PAGES); i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      lines.push(...rebuildLines(tc.items));
      page.cleanup?.();
    }
  } finally {
    await doc.destroy().catch(() => {});
  }
  return lines;
}

// 统一入口：传入已下载的 PDF 字节，走 document-parser 的四通道路由
// （MinerU / Docling / GROBID / pdfjs，由它负责语言驱动的优先级与逐级降级）。
// 这里只做「统一结构 → 行数组 + 结构化表格」的适配，对外返回契约
// { lines, mineruTables } 保持不变（enrichSourcesFromOpenAccess 依赖它）。
// 注意：解析全部失败时 parseDocument 会抛错，与上层的 MinerU→pdfjs 回退逻辑衔接。
async function extractPdfText(buf) {
  const result = await parseDocument(buf, { filename: 'paper.pdf', wantTables: true });
  const lines = [];
  for (const block of result.blocks) {
    // 块文本本身可能含换行（pdfjs 逐页通道一页就是一个块），展开成行以喂给指标/表格挖掘
    lines.push(...String(block.text || '').split('\n'));
  }
  // 通道自带的结构化表格（Docling grid / MinerU content_list）质量最高，直接采用
  const tables = Array.isArray(result.tables) ? result.tables : [];
  if (lines.length === 0 && tables.length === 0) throw new Error('解析结果为空');
  return { lines: lines.map((s) => s.trim()).filter(Boolean), mineruTables: tables };
}

// 从重建行中提取数据表：连续出现 ≥3 个数值 token 的行视为表格行
export function extractDataTables(lines, paper, maxTables = 3) {
  const tables = [];
  let current = null;
  const flush = () => {
    if (current && current.rows.length >= 3) tables.push(current);
    current = null;
    return tables.length >= maxTables;
  };
  for (const line of lines) {
    if (line.length > 200) continue; // 跳过正文长句
    const tokens = line.split(/\s{2,}|\t/).map((s) => s.trim()).filter(Boolean);
    const numericCount = tokens.filter((t) => /^-?\d+(\.\d+)?%?$/.test(t)).length;
    if (numericCount >= 3 && tokens.length >= 3) {
      if (!current) current = { title: null, rows: [] };
      // 首行若含非数值单元格视为表头
      current.rows.push(tokens.slice(0, 8));
      if (current.rows.length >= 12 && flush()) break;
    } else if (current) {
      if (flush()) break;
    }
  }
  if (current && tables.length < maxTables && current.rows.length >= 3) flush();
  return tables.map((t) => ({
    source: paper.title,
    year: paper.year,
    source_url: paper.source_url,
    source_db: paper.source_db,
    rows: t.rows,
  }));
}

// 富集数据源：对带 OA PDF 的论文下载全文提取指标与表格（失败静默降级）
// MinerU 通道优先（若配置）；MinerU 调用失败自动回退内置 pdfjs 通道
// 返回 { benchmarks（含 PDF 提取合并结果）, tables }
export async function enrichSourcesFromOpenAccess(papers, benchmarks = []) {
  const merged = Array.isArray(benchmarks) ? benchmarks.map((b) => ({ ...b })) : [];
  const tables = [];
  const candidates = (papers || []).filter((p) => p?.pdf_url && /^https:\/\//i.test(p.pdf_url)).slice(0, PDF_MAX_PAPERS);

  for (let i = 0; i < candidates.length; i += PDF_CONCURRENCY) {
    const batch = candidates.slice(i, i + PDF_CONCURRENCY);
    await Promise.all(batch.map(async (p) => {
      let extracted = null;
      let buf = null;
      try {
        // 下载一次 PDF，MinerU 失败回退 pdfjs 时复用同一 buffer，避免重复下载
        buf = await downloadPdfBytes(p.pdf_url);
      } catch (err) {
        logger.warn('paper-distillation', `OA PDF 下载失败（忽略）: ${(p.title || '').slice(0, 40)} - ${err.message}`);
        return;
      }
      try {
        extracted = await extractPdfText(buf);
      } catch (err) {
        // MinerU 通道失败时，回退内置 pdfjs 通道（复用已下载的 buf，不重复下载）
        if (MINERU_API_URL) {
          try {
            extracted = { lines: await parsePdfViaPdfjs(buf), mineruTables: [] };
            logger.warn('paper-distillation', `MinerU 解析失败，已回退 pdfjs: ${(p.title || '').slice(0, 40)} - ${err.message}`);
          } catch (err2) {
            logger.warn('paper-distillation', `OA PDF 数据提取失败（忽略）: ${(p.title || '').slice(0, 40)} - ${err2.message}`);
          }
        } else {
          logger.warn('paper-distillation', `OA PDF 数据提取失败（忽略）: ${(p.title || '').slice(0, 40)} - ${err.message}`);
        }
      }
      if (!extracted) return;
      const { lines, mineruTables } = extracted;

      const metrics = extractMetricsFromText(lines.join('\n'));
      if (metrics.length > 0) {
        merged.push({
          paperTitle: p.title,
          paperYear: p.year,
          source_db: p.source_db,
          source_url: p.source_url,
          metrics: metrics.slice(0, 8),
          from_fulltext: true,
        });
      }
      if (mineruTables.length > 0) {
        // MinerU 结构化表格：质量高，优先采用（保留来源标注）
        for (const rows of mineruTables) {
          tables.push({
            source: p.title,
            year: p.year,
            source_url: p.source_url,
            source_db: p.source_db,
            rows: rows.slice(0, 12).map((r) => r.slice(0, 8)),
            from_mineru: true,
          });
        }
      } else {
        tables.push(...extractDataTables(lines, p));
      }
    }));
  }
  return { benchmarks: merged, tables: tables.slice(0, 3) };
}

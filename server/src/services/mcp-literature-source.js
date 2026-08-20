/**
 * 中文文献 MCP 源适配器（可选插件，默认禁用）
 *
 * 通过 Model Context Protocol 连接外部文献检索 MCP server（默认对接 cnki-mcp：
 * https://github.com/wuruiqi/cnki-mcp，知网文献检索/下载/Zotero 导入）。
 *
 * 启用方式（环境变量）：
 *   CNKI_MCP_COMMAND=uvx            CNKI_MCP_ARGS=cnki-mcp
 *   （或任意可执行命令，如 python -m cnki_mcp）
 *
 * 设计要点：
 *   - 懒启动 + 单例：首次检索时才拉起子进程，失败自动降级（不影响其他检索源）
 *   - 工具自适应：从 tools/list 中自动发现 search 类工具（兼容不同版本工具命名）
 *   - 结果宽容解析：兼容 JSON 数组 / {results} 包裹 / 纯文本列表多种返回格式
 *   - 自带熔断：连续失败 3 次熔断 60 秒，防止浏览器自动化故障拖垮主流程
 *
 * 合规提示：知网检索依赖用户登录态与浏览器自动化（cnki-mcp 自带），
 * 商用部署前请确认知网服务条款；该通道默认关闭，由部署方显式开启。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import logger from '../logger.js';
import { dedupKeyOf } from '../utils.js';

const MCP_COMMAND = (process.env.CNKI_MCP_COMMAND || '').trim();

function parseMCPArgs(raw) {
  const s = (raw || '').trim();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // 空格分隔的命令行参数（简单切分，不支持带空格参数）
    return s.split(/\s+/).filter(Boolean);
  }
}

const MCP_ARGS = parseMCPArgs(process.env.CNKI_MCP_ARGS);
const MCP_TIMEOUT_MS = Number(process.env.CNKI_MCP_TIMEOUT || 45000);

// ===== 连接管理（懒启动 + 单例） =====
let clientPromise = null;
let failures = 0;
let openUntil = 0; // 熔断截止时间戳

export function isCnkiMCPConfigured() {
  return !!MCP_COMMAND;
}

// 显式关闭 MCP 连接（测试/优雅退出用）：关闭 client 与 transport，终止子进程
export async function closeCnkiMCP() {
  if (!clientPromise) return;
  const pending = clientPromise;
  clientPromise = null;
  try {
    const { client, transport } = await pending;
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  } catch { /* 连接可能从未成功建立 */ }
}

function isCircuitOpen() {
  return Date.now() < openUntil;
}

function recordFailure(message) {
  failures += 1;
  if (failures >= 3) {
    openUntil = Date.now() + 60 * 1000;
    failures = 0;
    logger.warn('cnki-mcp', `连续失败 3 次，熔断 60 秒。最后错误: ${message}`);
  }
}

async function getClient() {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const transport = new StdioClientTransport({
      command: MCP_COMMAND,
      args: MCP_ARGS,
      stderr: 'pipe',
      env: { ...process.env },
    });
    const client = new Client({ name: 'scholarforge', version: '1.0.0' });
    await client.connect(transport);
    logger.info('cnki-mcp', `MCP 文献源已连接: ${MCP_COMMAND} ${MCP_ARGS.join(' ')}`);
    return { client, transport };
  })().catch((err) => {
    clientPromise = null;
    throw err;
  });
  return clientPromise;
}

// 从 tools/list 中自动发现检索工具（兼容不同版本的命名差异）
function findSearchTool(tools) {
  const list = Array.isArray(tools) ? tools : [];
  const known = ['search_cnki', 'cnki_search', 'search_cnki_literature', 'search_literature', 'search'];
  for (const name of known) {
    const hit = list.find((t) => t && t.name === name);
    if (hit) return hit;
  }
  return list.find((t) => t && t.name && /search|检索|文献/.test(t.name)) || null;
}

// ===== 结果解析（宽容） =====
function normalizeCnkiItem(item) {
  if (!item || typeof item !== 'object') return null;
  const title = String(item.title || item.name || item['题名'] || item['标题'] || '').trim();
  if (!title) return null;
  const authorsRaw = String(item.authors || item.author || item['作者'] || '');
  return {
    title,
    authors: authorsRaw ? authorsRaw.replace(/\s*[;；]\s*/g, ', ').replace(/,\s*,/g, ',').trim() : '佚名',
    year: String(item.year || item['年份'] || item.publish_year || item.published_year || ''),
    journal: String(item.journal || item.source || item['来源'] || item['刊名'] || '知网'),
    doi: String(item.doi || ''),
    abstract: String(item.abstract || item.summary || item['摘要'] || ''),
    cited_by_count: Number(item.cited_by_count || item.citations || item['被引'] || 0) || 0,
    source_url: String(item.url || item.link || item.source_url || ''),
    source_db: 'CNKI',
    pdf_url: '',
    _dedupKey: dedupKeyOf(title),
  };
}

export function parseCnkiResult(text, limit = 8) {
  if (!text) return [];
  // 1. 尝试 JSON（数组 或 {results/data/papers/items} 包裹）
  try {
    const obj = JSON.parse(text);
    const arr = Array.isArray(obj)
      ? obj
      : obj.results || obj.data || obj.papers || obj.items || [];
    if (Array.isArray(arr)) {
      return arr.slice(0, limit).map(normalizeCnkiItem).filter(Boolean);
    }
  } catch { /* 非 JSON，走文本启发式 */ }

  // 2. 文本启发式：按行解析"标题 / 作者 / 来源 年份"块
  const papers = [];
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  let i = 0;
  while (i < lines.length && papers.length < limit) {
    const line = lines[i];
    // 行首为数字编号的视为标题行（如 "1. 论文标题"）
    const titleMatch = line.match(/^(?:\d+[.、)]\s*)?(.{4,200})$/);
    if (!titleMatch) { i++; continue; }
    const title = titleMatch[1].replace(/^\[|\]$/g, '').trim();
    const authors = (lines[i + 1] || '').replace(/^作者[:：]\s*/, '').trim();
    const srcLine = (lines[i + 2] || '').trim();
    const yearMatch = srcLine.match(/(19|20)\d{2}/);
    const journal = srcLine.replace(/[（(](19|20)\d{2}[)）].*$/, '').trim();
    papers.push({
      title,
      authors: authors && !/^\d{4}/.test(authors) ? authors : '佚名',
      year: yearMatch ? yearMatch[0] : '',
      journal: journal || '知网',
      doi: '',
      abstract: '',
      cited_by_count: 0,
      source_url: '',
      source_db: 'CNKI',
      pdf_url: '',
      _dedupKey: dedupKeyOf(title),
    });
    i += 3;
  }
  return papers;
}

// ===== 主入口 =====
// 返回 { papers, disabled, circuitOpen, error }
export async function searchCnkiViaMCP(query, limit = 8) {
  if (!isCnkiMCPConfigured()) return { papers: [], disabled: true };
  if (isCircuitOpen()) return { papers: [], disabled: false, circuitOpen: true };
  try {
    const { client } = await getClient();
    const { tools } = await client.listTools();
    const tool = findSearchTool(tools);
    if (!tool) throw new Error('tools/list 中未发现 search 类工具');
    // 外层超时兜底（MCP 调用可能因浏览器自动化长时间无响应）
    const callPromise = client.callTool({
      name: tool.name,
      arguments: { query, limit, max_results: limit, count: limit },
    });
    const res = await Promise.race([
      callPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('MCP 调用超时')), MCP_TIMEOUT_MS)),
    ]);
    const text = (res?.content || [])
      .filter((c) => c && c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    const papers = parseCnkiResult(text, limit);
    failures = 0;
    return { papers, disabled: false };
  } catch (err) {
    recordFailure(err.message);
    logger.warn('cnki-mcp', `检索失败（忽略，不影响其他源）: ${err.message}`);
    // 连接已建立后子进程崩溃：重置连接引用，下次调用重新拉起子进程
    // （此前旧连接会永久失效，直到整个服务重启）
    if (clientPromise) {
      const stale = clientPromise;
      clientPromise = null;
      stale.then(({ client, transport }) => {
        client.close().catch(() => {});
        transport.close().catch(() => {});
      }).catch(() => {});
    }
    return { papers: [], disabled: false, error: err.message };
  }
}

// Quarto / Pandoc 出版级导出客户端（可选插件）
//
// 方案建议：用 Quarto（或退而求其次 Pandoc）实现出版级导出——把已生成的
// Markdown 正文 + 参考文献（CSL 格式化）编译为 DOCX / PDF / LaTeX / HTML 等
// 出版级成品，替换「手写 docx-generator 拼装」的单一导出路径。
//
// 本模块只负责「调用外部 quarto / pandoc 可执行文件」，不内嵌编译逻辑：
//   - 优先 QUARTO_BIN（quarto 可执行路径）；缺失则回退 PANDOC_BIN；
//   - 二者都未配置时 isQuartoConfigured() 返回 false，调用方走既有 docx-generator。
//
// 设计原则（与 docling-client / grobid-client / paperqa-client / zotero-client 一致）：
//   - 所有失败一律 throw，由调用方决定是否降级；
//   - 环境变量在调用时读取；
//   - 外部命令通过 child_process.execFile 执行（禁用 shell，防注入）。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import logger from '../logger.js';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 120000;
const SUPPORTED_FORMATS = ['docx', 'pdf', 'latex', 'html', 'epub', 'pptx', 'odt'];

function readConfig() {
  const quartoBin = String(process.env.QUARTO_BIN || '').trim();
  const pandocBin = String(process.env.PANDOC_BIN || '').trim();
  const rawTimeout = Number(process.env.QUARTO_TIMEOUT_MS || process.env.PANDOC_TIMEOUT_MS);
  const timeout = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_TIMEOUT_MS;
  return { quartoBin, pandocBin, timeout };
}

/**
 * 是否可用（quarto 或 pandoc 可执行文件已配置）。
 */
export function isQuartoConfigured() {
  const { quartoBin, pandocBin } = readConfig();
  return Boolean(quartoBin || pandocBin);
}

// 归一化目标格式：非法格式抛错，避免把任意字符串塞进命令行
export function normalizeFormat(format) {
  const fmt = String(format || 'docx').toLowerCase();
  if (!SUPPORTED_FORMATS.includes(fmt)) {
    throw new Error(`不支持的导出格式: ${format}（支持 ${SUPPORTED_FORMATS.join('/')}）`);
  }
  return fmt;
}

// 构造 pandoc 参数（quarto 也兼容 pandoc 风格的 --to / --from / --metadata 等参数，
// 只是 quarto 额外处理 QMD 的 YAML 前端、计算代码块等；这里导出普通 Markdown，二者等价）
function buildArgs({ format, bibliography, csl, from = 'markdown' }) {
  const args = [];
  if (bibliography) {
    // 参考文献：BibTeX (.bib) 或 CSL-JSON (.json)
    args.push(`--bibliography=${bibliography}`);
  }
  if (csl) {
    // 引用样式：本地 CSL 文件路径
    args.push(`--csl=${csl}`);
  }
  args.push('--from', from);
  args.push('--to', format);
  return args;
}

/**
 * 导出单个 Markdown 源文件到指定格式。
 * @param {string} inputPath 输入 Markdown 文件绝对路径
 * @param {string} outputPath 输出文件绝对路径（扩展名应与 format 一致）
 * @param {{ format?: string, bibliography?: string, csl?: string, from?: string }} [options]
 * @returns {Promise<{ outputPath: string, format: string, engine: 'quarto' | 'pandoc' }>}
 */
export async function exportDocument(inputPath, outputPath, options = {}) {
  const { quartoBin, pandocBin, timeout } = readConfig();
  const format = normalizeFormat(options.format || (outputPath.split('.').pop() || 'docx'));
  const args = buildArgs({
    format,
    bibliography: options.bibliography,
    csl: options.csl,
    from: options.from,
  });

  if (quartoBin) {
    // quarto render 对普通 .md 也能输出多种格式，但更简单的等价路径是 quarto pandoc
    // 这里优先走 quarto 的 render 子命令（若输出到指定文件需 --output）
    try {
      await execFileAsync(quartoBin, ['render', inputPath, '--to', format, '--output', outputPath], {
        timeout,
        windowsHide: true,
      });
      return { outputPath, format, engine: 'quarto' };
    } catch (err) {
      // quarto 失败（未安装完整/不支持）→ 回退 pandoc（若可用）
      if (!pandocBin) throw err;
      logger.warn('quarto-exporter', `quarto render 失败，回退 pandoc: ${err.message}`);
    }
  }

  if (!pandocBin) {
    throw new Error('未配置 QUARTO_BIN 或 PANDOC_BIN');
  }

  await execFileAsync(pandocBin, [inputPath, '-o', outputPath, ...args], {
    timeout,
    windowsHide: true,
  });
  return { outputPath, format, engine: 'pandoc' };
}

/**
 * 导出多个 Markdown 章节，合并为一个出版级成品（走 pandoc，可附带参考文献与 CSL）。
 * @param {string[]} inputPaths 多个 Markdown 文件绝对路径（按顺序合并）
 * @param {string} outputPath 输出文件绝对路径
 * @param {{ format?: string, bibliography?: string, csl?: string, from?: string }} [options]
 * @returns {Promise<{ outputPath: string, format: string, engine: string }>}
 */
export async function exportConcatenated(inputPaths, outputPath, options = {}) {
  const { quartoBin, pandocBin, timeout } = readConfig();
  const format = normalizeFormat(options.format || (outputPath.split('.').pop() || 'docx'));
  const args = buildArgs({
    format,
    bibliography: options.bibliography,
    csl: options.csl,
    from: options.from,
  });

  const engine = quartoBin ? 'quarto' : pandocBin ? 'pandoc' : null;
  if (!engine) throw new Error('未配置 QUARTO_BIN 或 PANDOC_BIN');

  // 多文件合并用 pandoc 最直接（quarto 的多输入合并语义不同），故统一走 pandoc 路径；
  // 若只有 quarto 可用，则退化为逐个 render 后由调用方合并，这里先报错引导配置 PANDOC_BIN。
  if (engine === 'quarto' && !pandocBin) {
    throw new Error('多文件合并导出需要 PANDOC_BIN（QUARTO_BIN 仅支持单文件 render）');
  }

  const bin = pandocBin || quartoBin;
  await execFileAsync(bin, [...inputPaths, '-o', outputPath, ...args], {
    timeout,
    windowsHide: true,
  });
  return { outputPath, format, engine };
}

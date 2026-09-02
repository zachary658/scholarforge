// CSL 官方样式库格式化（替换手写 GB/T 7714 拼接）
//
// 方案建议：用 CSL（Citation Style Language）官方样式库替换手写 GB/T 7714 拼接规则。
// citation-js 已内置 @citation-js/plugin-csl（含官方 CSL 样式库），本模块封装之，
// 使参考文献格式化从「手写正则拼接」升级为「官方样式引擎驱动」，支持 GB/T 7714-2015
// 及其它数百种期刊样式（APA/MLA/Chicago/各期刊）。
//
// 兼容性：formatReferencesGB（paper-distillation.js）的手写实现仍保留作为无依赖兜底；
// 本模块在其不可用（citation-js 未安装/样式缺失）时自动回退，绝不阻断导出流程。
//
// 设计原则：
//   - 纯函数、可脱离 DB 单测；
//   - 输出与手写版保持「编号 + 责任者 + 题名 + 期刊 + 年份 + DOI」的兼容格式，
//     但由官方样式引擎保证各文献类型（期刊/专著/学位论文/会议/网页）的字段与标点正确。
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import logger from '../logger.js';

// ESM 下 require 未定义，需通过 createRequire 构造（用于 require.resolve 探测依赖）
const require = createRequire(import.meta.url);

// 本地样式/locale 文件路径（官方 CSL 样式库，CC BY-SA 3.0）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_GB_STYLE = path.join(__dirname, 'styles', 'gb-t-7714-2015-numeric.csl');
const LOCAL_ZH_LOCALE = path.join(__dirname, 'locales', 'locales-zh-CN.xml');

// 注册到 citation-js 的本地样式名（区别于文件路径），以及默认 locale
const GB_STYLE_ID = 'gb-t-7714-2015-numeric';
const DEFAULT_LOCALE = 'zh-CN';

// 默认样式：优先使用本地 GB/T 7714-2015 官方样式；可通过环境变量 CSL_STYLE 切换
// （值可为内置样式名如 "apa"/"vancouver"/"harvard1"，或本地 CSL 文件路径）
const DEFAULT_CSL_STYLE = process.env.CSL_STYLE || GB_STYLE_ID;

// 模块级单例：已注册的 Cite 类与注册状态，避免重复 import/读文件
let _Cite = null;
let _registered = false;

async function loadCite() {
  // plugin-csl 注册到 citation-js 后，import('citation-js') 即可用 format('bibliography', ...)
  if (_Cite) return _Cite;
  const { default: Cite } = await import('citation-js');
  // 显式加载 CSL 插件（自动注册样式库与 format 输出）
  await import('@citation-js/plugin-csl');
  _Cite = Cite;
  return Cite;
}

// 读取本地 CSL 样式/locale 文件内容
async function readLocalFile(filePath) {
  return readFile(filePath, 'utf8');
}

// 把本地官方 GB/T 7714-2015 样式 + zh-CN locale 注册进 citation-js 模板库。
// plugin-csl 的 config 结构为 { engine, locales, styles }，其中 locales/styles 均为
// util.Register 实例（有 .add/.has/.get 方法），且内置 locale 直接存 XML 字符串。
// 幂等：重复调用不会重复注册。
async function ensureLocalStyles(Cite) {
  if (_registered) return;
  const config = Cite.plugins?.config?.get?.('@csl');
  const styles = config?.styles;
  if (!styles || typeof styles.add !== 'function') {
    // 无法注册（插件结构变化），不阻断：后续渲染会失败并回退到 formatReferencesGB
    logger.warn('csl-formatter', 'citation-js CSL styles.add 不可用，无法注册本地样式');
    return;
  }
  try {
    const [styleXml, localeXml] = await Promise.all([
      readLocalFile(LOCAL_GB_STYLE),
      readLocalFile(LOCAL_ZH_LOCALE),
    ]);
    styles.add(GB_STYLE_ID, styleXml);
    // locale 注册：Register.add(key, xmlString)，与内置 locales.json 存储格式一致
    if (config.locales && typeof config.locales.add === 'function') {
      config.locales.add(DEFAULT_LOCALE, localeXml);
    }
    _registered = true;
  } catch (err) {
    logger.warn('csl-formatter', `注册本地 GB/T 7714 样式/locale 失败: ${err.message}`);
  }
}

// 把 ScholarForge reference 结构转成 citation-js 可识别的 CSL-JSON 数据
function toCslJson(reference) {
  const r = reference || {};
  const authors = String(r.authors || '')
    .split(/[,;；]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => {
      // 简化姓名拆分：中文「张三」「张 三」→ family=张三；英文「Ronneberger O., Fischer P.」已在上层拆成多作者
      const parts = name.split(/\s+/);
      if (parts.length === 1) return { family: parts[0], given: '' };
      // 英文「First Last」→ given=First family=Last；「Last, First」已在 split 时按逗号拆开
      return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(' ') };
    });
  const typeMap = {
    journal: 'article-journal', article: 'article-journal', J: 'article-journal',
    book: 'book', thesis: 'thesis', dissertation: 'thesis', conference: 'paper-conference',
    webpage: 'webpage', patent: 'patent',
  };
  return {
    type: typeMap[r.item_type] || typeMap[r.type] || 'article-journal',
    title: r.title || '',
    author: authors,
    'container-title': r.journal || '',
    issued: r.year ? { 'date-parts': [[Number(r.year)]] } : undefined,
    DOI: r.doi || '',
    volume: r.volume || '',
    issue: r.issue || '',
    page: r.pages || '',
    URL: r.source_url || '',
  };
}

/**
 * 用官方 CSL 样式格式化参考文献列表（GB/T 7714-2015 顺序编码制）。
 * @param {Array<object>} references ScholarForge reference 数组
 * @param {{ style?: string, locale?: string }} [options] style 为 CSL 样式 ID 或本地文件路径
 * @returns {Promise<{ text: string, style: string, usedCsl: boolean }>}
 *   text 为编号制格式化结果（不含 [n] 前缀，由调用方按需加编号）
 * @throws 样式缺失/引擎失败时抛错，由调用方回退到 formatReferencesGB
 */
export async function formatReferencesWithCsl(references, { style = DEFAULT_CSL_STYLE, locale = DEFAULT_LOCALE } = {}) {
  if (!Array.isArray(references) || references.length === 0) {
    return { text: '', style, usedCsl: true };
  }
  const Cite = await loadCite();
  await ensureLocalStyles(Cite);
  const data = references.map(toCslJson).filter((d) => d.title);
  if (data.length === 0) return { text: '', style, usedCsl: true };

  const cite = new Cite(data);
  // 样式：内置名（apa/vancouver/harvard1）、注册名（gb-t-7714-2015-numeric）或本地 CSL 文件路径均可
  const opts = { format: 'text', template: style, lang: locale };
  try {
    const out = cite.format('bibliography', opts);
    return { text: Array.isArray(out) ? out.join('\n') : String(out), style, usedCsl: true };
  } catch (err) {
    logger.warn('csl-formatter', `CSL 样式 ${style} 渲染失败: ${err.message}`);
    throw err;
  }
}

/**
 * 便捷入口：输出与 formatReferencesGB 兼容的最终文本。
 * 注意：GB/T 7714 官方样式在 bibliography 的 <layout> 中已自带 "[n] " 编号前缀
 * （citation-number 变量），故这里直接返回 CSL 输出，不再二次加编号，避免 "[1] [1] ..."。
 * @returns {Promise<string>}
 */
export async function formatReferencesGBWithCsl(references) {
  try {
    const { text } = await formatReferencesWithCsl(references);
    if (!text) return '';
    // 仅清理空行与首尾空白，保留样式引擎产出的 "[n] " 前缀
    return text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((l) => l.length > 0)
      .join('\n');
  } catch (err) {
    // 回退：由调用方用 formatReferencesGB 兜底
    throw err;
  }
}

/**
 * 是否可用（citation-js + plugin-csl 均已安装）。
 * 供调用方决定走 CSL 还是手写兜底。
 */
export function isCslAvailable() {
  try {
    return Boolean(require.resolve('@citation-js/plugin-csl'));
  } catch {
    return false;
  }
}

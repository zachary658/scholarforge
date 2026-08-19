// Word 文档生成服务（增强版）
// 支持知网级论文输出：文本 + 图片（数据图表/流程图）+ 表格（三线表）+ 数学公式
// 学术规范样式：宋体小四正文 / 黑体标题 / 1.5 倍行距 / 首行缩进 2 字符
// 若用户提供模板，则按模板样式覆盖（template-parser 解析）
//
import logger from '../logger.js';
// 公式处理升级（2026-08）：
//   原方案：mathjax 渲染 LaTeX → PNG 图片嵌入（不可编辑）
//   新方案：mathjax@4 + mathml2omml → Word 原生可编辑公式（OMML）
//   优势：公式在 Word 中可双击编辑，字体与正文一致，符合知网收录要求
//   （详见 ./latex-omml.js，已移除废弃的 mathjax-node / latex-to-omml 传递依赖）
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  LevelFormat,
  Footer,
  Header,
  PageNumber,
  ExternalHyperlink,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
} from 'docx';
import { latexToOMML } from './latex-omml.js';
import { createRequire } from 'module';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import db from '../db.js';
import { renderBlock } from './chart-renderer.js';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');

// 公式占位符格式：在 document.xml 中用唯一标记包裹，后处理时替换为 OMML XML
// 格式：{{SF_MATH:base64(latex)}}，避免特殊字符干扰 XML
function makeMathPlaceholder(latex) {
  return `{{SF_MATH:${Buffer.from(latex).toString('base64')}}}`;
}

// 后处理：把 docx 中的公式占位符替换为原生 OMML XML
async function injectOMMLIntoDocx(filePath, mathPlaceholders) {
  if (mathPlaceholders.length === 0) return;

  const zip = new AdmZip(filePath);
  let docXml = zip.readAsText('word/document.xml');

  for (const { placeholder, latex } of mathPlaceholders) {
    try {
      // latex-to-omml 生成完整的 <m:oMath>...</m:oMath> XML
      const omml = await latexToOMML(latex, { displayMode: true });
      // 去掉重复的命名空间声明（document.xml 已声明）
      const cleanOmml = omml
        .replace(/xmlns:m="[^"]*"/g, '')
        .replace(/xmlns:w="[^"]*"/g, '')
        .replace(/<m:oMath\s+/, '<m:oMath ');
      // 占位符在 <w:p>...<w:t>{{SF_MATH:xxx}}</w:t>...</w:p> 中
      // 需要把整个 <w:p> 替换为含 OMML 的段落
      // 简化方案：直接把 <w:t>...占位符...</w:t> 替换为 OMML（放在段落内）
      // P10: 用字符串 split/join 替代正则，避免 base64 特殊字符（+、/、=）导致正则异常
      const prefix = `<w:t`;
      const suffix = `>${placeholder}</w:t>`;
      const parts = docXml.split(prefix);
      const result = [parts[0]];
      for (let i = 1; i < parts.length; i++) {
        const idx = parts[i].indexOf(suffix);
        if (idx !== -1) {
          // 找到 <w:t ...>placeholder</w:t>，替换为 OMML
          result.push(parts[i].substring(0, idx) + cleanOmml + parts[i].substring(idx + suffix.length));
        } else {
          result.push(prefix + parts[i]);
        }
      }
      docXml = result.join('');
    } catch (e) {
      logger.error('docx', `公式注入失败: ${latex} ${e.message}`);
      // 降级：将占位符替换为可读文本 [公式: latex]，而非 base64 乱码
      const fallbackText = `[公式: ${latex}]`;
      docXml = docXml.split(placeholder).join(fallbackText);
    }
  }

  zip.updateFile('word/document.xml', Buffer.from(docXml, 'utf8'));
  zip.writeZip(filePath);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsDir = join(__dirname, '..', '..', 'uploads', 'docs');
if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

// 默认学术样式配置
const DEFAULT_STYLES = {
  bodyFont: '宋体',
  bodySize: 24, // 12pt = 24 half-points
  bodyColor: '000000',
  bodyLineSpacing: 360, // 1.5 倍 = 240 * 1.5
  bodyIndent: { firstLine: 480 }, // 2 字符 = 480 twips（小四）
  headingFont: '黑体',
  headingColor: '000000',
  titleSize: 36, // 18pt
  h1Size: 32, // 16pt
  h2Size: 28, // 14pt
  h3Size: 26, // 13pt
  titleAlign: AlignmentType.CENTER,
  bodyAlign: AlignmentType.JUSTIFIED,
};

// 合并模板样式
function resolveStyles(template = null) {
  if (!template) return DEFAULT_STYLES;
  let parsed = {};
  try {
    parsed = typeof template.styles_json === 'string' ? JSON.parse(template.styles_json) : (template.styles_json || {});
  } catch {
    parsed = {};
  }
  return { ...DEFAULT_STYLES, ...parsed };
}

// ===== Markdown 解析（增强版）=====
// 支持的 block 类型：
//   title/h1/h2/h3/p/bullet/empty（原有）
//   code_mermaid { code }         - mermaid 流程图代码
//   code_vega { code }            - vega-lite 图表 JSON
//   code_math { code }            - LaTeX 公式（独立块）
//   table { rows, caption }       - markdown 表格
//   math_inline { latex }         - 行内公式 $...$
//   figure_caption { text }       - 图题（图 1-1 xxx）
//   table_caption { text }        - 表题（表 1-1 xxx）

function parseMarkdownToBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // 代码块开始：```mermaid / ```vega / ```chart / ```math
    const codeBlockMatch = line.match(/^```(\w+)/);
    if (codeBlockMatch) {
      const lang = codeBlockMatch[1].toLowerCase();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // 跳过结束的 ```
      const code = codeLines.join('\n');
      if (lang === 'mermaid' || lang === 'flowchart') {
        blocks.push({ type: 'code_mermaid', code });
      } else if (lang === 'vega' || lang === 'chart') {
        blocks.push({ type: 'code_vega', code });
      } else if (lang === 'math' || lang === 'latex') {
        blocks.push({ type: 'code_math', code });
      }
      // 其他代码块忽略（不渲染）
      continue;
    }

    // 独立公式 $$...$$
    const displayMathMatch = line.match(/^\$\$(.+)\$\$$/);
    if (displayMathMatch) {
      blocks.push({ type: 'code_math', code: displayMathMatch[1].trim() });
      i++;
      continue;
    }
    // 多行 $$...$$ 开始
    if (line.trim() === '$$') {
      const mathLines = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '$$') {
        mathLines.push(lines[i]);
        i++;
      }
      i++; // 跳过结束的 $$
      blocks.push({ type: 'code_math', code: mathLines.join('\n') });
      continue;
    }

    // markdown 表格（| ... | 开头，下一行是 |---|---|）
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\|[\s:-]+\|/.test(lines[i + 1].trim())) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }
      // 解析表格
      const header = parseTableRow(tableLines[0]);
      const dataRows = tableLines.slice(2).map(parseTableRow);
      blocks.push({ type: 'table', header, rows: dataRows });
      continue;
    }

    // 图题/表题（图 1-1 / 表 1-1 / Fig. / Table）
    const captionMatch = line.match(/^(图|表)\s*\d+[\.-]\d+[\s.]/);
    if (captionMatch) {
      const isTable = captionMatch[1] === '表';
      blocks.push({ type: isTable ? 'table_caption' : 'figure_caption', text: line.trim() });
      i++;
      continue;
    }

    // 空行
    if (!line.trim()) {
      blocks.push({ type: 'empty' });
      i++;
      continue;
    }

    // 标题
    let m;
    if ((m = line.match(/^#\s+(.*)$/))) {
      blocks.push({ type: 'title', text: m[1] });
    } else if ((m = line.match(/^##\s+(.*)$/))) {
      blocks.push({ type: 'h1', text: m[1] });
    } else if ((m = line.match(/^###\s+(.*)$/))) {
      blocks.push({ type: 'h2', text: m[1] });
    } else if ((m = line.match(/^####\s+(.*)$/))) {
      blocks.push({ type: 'h3', text: m[1] });
    } else if ((m = line.match(/^\s*[-•]\s+(.*)$/))) {
      blocks.push({ type: 'bullet', text: m[1] });
    } else {
      // 普通段落（可能含行内公式 $...$）
      blocks.push({ type: 'p', text: line });
    }
    i++;
  }
  return blocks;
}

// 解析表格行 "| a | b |" → ["a", "b"]
function parseTableRow(line) {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

// ===== 异步渲染所有图表块 =====
// code_mermaid/code_vega → 渲染为 PNG 图片
// code_math → 生成占位符文本，收集到 mathPlaceholders，生成docx后注入OMML
async function renderBlocks(blocks) {
  const rendered = [];
  const mathPlaceholders = []; // { placeholder, latex }
  for (const block of blocks) {
    try {
      if (block.type === 'code_mermaid') {
        const { buffer, width, height } = await renderBlock('mermaid', block.code);
        rendered.push({ type: 'image', png: buffer, width, height });
      } else if (block.type === 'code_vega') {
        const { buffer, width, height } = await renderBlock('vega', block.code);
        rendered.push({ type: 'image', png: buffer, width, height });
      } else if (block.type === 'code_math') {
        // 生成占位符文本，后续生成 docx 后注入 OMML XML
        const placeholder = makeMathPlaceholder(block.code);
        mathPlaceholders.push({ placeholder, latex: block.code });
        rendered.push({ type: 'math_placeholder', text: placeholder });
      } else {
        rendered.push(block);
      }
    } catch (err) {
      logger.error('docx', `图表渲染失败: ${err.message}`);
      rendered.push({ type: 'p', text: '[图表渲染失败]' });
    }
  }
  return { rendered, mathPlaceholders };
}

// ===== blocks → docx Paragraph/Table 转换 =====

function makeTextRun(text, styles, opts = {}) {
  return new TextRun({
    text,
    font: opts.font || styles.bodyFont,
    size: opts.size || styles.bodySize,
    bold: opts.bold || false,
    color: opts.color || styles.bodyColor,
  });
}

function blockToDocxElement(block, styles) {
  switch (block.type) {
    case 'title':
      return new Paragraph({
        alignment: styles.titleAlign,
        spacing: { before: 240, after: 240, line: styles.bodyLineSpacing },
        children: [makeTextRun(block.text, styles, { font: styles.headingFont, size: styles.titleSize, bold: true, color: styles.headingColor })],
      });
    case 'h1':
      return new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 240, after: 120, line: styles.bodyLineSpacing },
        children: [makeTextRun(block.text, styles, { font: styles.headingFont, size: styles.h1Size, bold: true, color: styles.headingColor })],
      });
    case 'h2':
      return new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 200, after: 100, line: styles.bodyLineSpacing },
        children: [makeTextRun(block.text, styles, { font: styles.headingFont, size: styles.h2Size, bold: true, color: styles.headingColor })],
      });
    case 'h3':
      return new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 160, after: 80, line: styles.bodyLineSpacing },
        children: [makeTextRun(block.text, styles, { font: styles.headingFont, size: styles.h3Size, bold: true, color: styles.headingColor })],
      });
    case 'bullet':
      return new Paragraph({
        alignment: styles.bodyAlign,
        spacing: { line: styles.bodyLineSpacing },
        bullet: { level: 0 },
        children: [makeTextRun(block.text, styles)],
      });
    case 'empty':
      return new Paragraph({ children: [new TextRun('')] });
    case 'p':
    default:
      return new Paragraph({
        alignment: styles.bodyAlign,
        spacing: { line: styles.bodyLineSpacing },
        indent: styles.bodyIndent,
        children: [makeTextRun(block.text, styles)],
      });
    case 'image': {
      // 图片居中，限制最大宽度 500px（Word A4 正文宽度约 500px）
      const maxW = 500;
      let w = block.width;
      let h = block.height;
      if (w > maxW) {
        h = (h * maxW) / w;
        w = maxW;
      }
      return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: 60 },
        children: [
          new ImageRun({
            data: block.png,
            transformation: { width: Math.round(w), height: Math.round(h) },
          }),
        ],
      });
    }
    case 'math_placeholder': {
      // 公式占位符段落（生成docx后注入OMML XML替换）
      return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: 120 },
        children: [makeTextRun(block.text, styles)],
      });
    }
    case 'figure_caption':
      // 图题：居中，小五号，黑体
      return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 40, after: 200 },
        children: [makeTextRun(block.text, styles, { font: styles.headingFont, size: 21, bold: true })],
      });
    case 'table_caption':
      // 表题：居中，小五号，黑体
      return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 40 },
        children: [makeTextRun(block.text, styles, { font: styles.headingFont, size: 21, bold: true })],
      });
    case 'table':
      return makeTable(block, styles);
  }
}

// 三线表：上下边框 + 表头下边框，无竖线
function makeTable(block, styles) {
  const { header, rows } = block;
  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const thickBorder = { style: BorderStyle.SINGLE, size: 12, color: '000000' }; // 1.5pt
  const thinBorder = { style: BorderStyle.SINGLE, size: 6, color: '000000' }; // 0.75pt

  const colCount = header.length;
  const colWidth = Math.floor(100 / colCount);

  const makeCell = (text, isHeader, isLastRow) => {
    return new TableCell({
      width: { size: colWidth, type: WidthType.PERCENTAGE },
      borders: {
        top: isHeader ? thickBorder : noBorder,
        bottom: isHeader ? thinBorder : (isLastRow ? thickBorder : noBorder),
        left: noBorder,
        right: noBorder,
      },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 40, after: 40 },
          children: [makeTextRun(text, styles, {
            font: styles.headingFont,
            size: 21, // 小五号
            bold: isHeader,
          })],
        }),
      ],
    });
  };

  const tableRows = [];
  // 表头行
  tableRows.push(
    new TableRow({
      tableHeader: true,
      children: header.map((h) => makeCell(h, true, false)),
    })
  );
  // 数据行
  rows.forEach((row, idx) => {
    const isLast = idx === rows.length - 1;
    // 补齐列数
    const padded = [...row];
    while (padded.length < colCount) padded.push('');
    tableRows.push(
      new TableRow({
        children: padded.map((c) => makeCell(c, false, isLast)),
      })
    );
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: tableRows,
    borders: {
      top: thickBorder,
      bottom: thickBorder,
      left: noBorder,
      right: noBorder,
      insideHorizontal: noBorder,
      insideVertical: noBorder,
    },
  });
}

// ===== 图表引用校验（阶段三 3.3）=====
// 扫描正文中的「图N/表N」引用，与实际插入的图题/表题编号比对，缺失则给出提示
function validateChartReferences(content) {
  if (!content) return [];
  const warnings = [];
  const figureNos = new Set();
  const tableNos = new Set();
  // 图题/表题编号：图 1-1 / 表 2-1 / 图1 / 表2
  const capRe = /^(图|表)\s*(\d+(?:[.\-]\d+)?)/gm;
  let m;
  while ((m = capRe.exec(content)) !== null) {
    (m[1] === '图' ? figureNos : tableNos).add(m[2]);
  }
  const has = (set, num) => set.has(num) || set.has(String(num).split(/[.\-]/)[0]);

  // 图引用：如图1-1 / 见图2
  const figRefRe = /(?:如图|见图)\s*(\d+(?:[.\-]\d+)?)/g;
  while ((m = figRefRe.exec(content)) !== null) {
    if (!has(figureNos, m[1])) warnings.push(`正文引用了「${m[0]}」，但未找到对应图题（图 ${m[1]}），请核对图表编号`);
  }
  // 表引用：如表2-1 / 见表3
  const tabRefRe = /(?:如表|见表)\s*(\d+(?:[.\-]\d+)?)/g;
  while ((m = tabRefRe.exec(content)) !== null) {
    if (!has(tableNos, m[1])) warnings.push(`正文引用了「${m[0]}」，但未找到对应表题（表 ${m[1]}），请核对图表编号`);
  }
  return warnings;
}

// 生成 Word 文档并落盘，返回 { filePath, fileName }
export async function generateDocx({
  title,
  content,
  feature,
  userId,
  template = null,
  orderId = null,
  includeWatermark = true,
}) {
  const styles = resolveStyles(template);
  const blocks = parseMarkdownToBlocks(content);
  // 图表引用校验（输出前）
  const warnings = validateChartReferences(content);

  // 异步渲染所有图表/公式块
  const { rendered, mathPlaceholders } = await renderBlocks(blocks);

  // 标题段
  const titlePara = new Paragraph({
    alignment: styles.titleAlign,
    spacing: { before: 0, after: 240, line: styles.bodyLineSpacing },
    children: [makeTextRun(title || '未命名文档', styles, { font: styles.headingFont, size: styles.titleSize, bold: true, color: styles.headingColor })],
  });

  const children = [titlePara, ...rendered.map((b) => blockToDocxElement(b, styles))];

  // 页脚水印
  const footers = includeWatermark
    ? {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: '本内容由 AI 辅助生成，仅供学习参考，请遵守学术规范 · 第 ',
                  font: styles.bodyFont,
                  size: 18,
                  color: '888888',
                }),
                new TextRun({ children: [PageNumber.CURRENT], font: styles.bodyFont, size: 18, color: '888888' }),
                new TextRun({ text: ' 页', font: styles.bodyFont, size: 18, color: '888888' }),
              ],
            }),
          ],
        }),
      }
    : undefined;

  const doc = new Document({
    creator: 'ScholarForge',
    title: title || '未命名文档',
    description: feature,
    sections: [
      {
        properties: {},
        footers,
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const ts = Date.now();
  const safeTitle = (title || 'doc').replace(/[^\w\u4e00-\u9fa5-]/g, '_').slice(0, 30);
  const fileName = `${userId}_${ts}_${feature}_${safeTitle}.docx`;
  const filePath = join(docsDir, fileName);
  // P11 原子写：先写临时文件，成功后再 rename 替换原文件，防止写入中途崩溃导致文件损坏
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, buffer);
  fs.renameSync(tmpPath, filePath);

  // 后处理：把公式占位符替换为 Word 原生可编辑公式（OMML XML）
  if (mathPlaceholders.length > 0) {
    await injectOMMLIntoDocx(filePath, mathPlaceholders);
  }

  // 落库
  const info = db.prepare(
    `INSERT INTO generated_docs (user_id, title, feature, file_path, order_id) VALUES (?, ?, ?, ?, ?)`
  ).run(userId, title || '未命名文档', feature, fileName, orderId || null);

  return {
    id: info.lastInsertRowid,
    filePath,
    fileName,
    downloadUrl: `/api/docs/download/${info.lastInsertRowid}`,
    warnings,
  };
}

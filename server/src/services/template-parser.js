// 格式模板解析服务
// 输入：用户上传的 .docx 文件
// 输出：解析后的样式 JSON（字体/字号/行距/段距/标题样式），存入 templates.styles_json
//
// 解析策略：
//   1. mammoth（主）：语义化解析 .docx，识别标题层级（h1-h6）与正文结构，
//      并通过 styleMap 兼容英文 Heading N 与中文「标题 N」样式名；
//   2. adm-zip（补充）：mammoth 的 HTML 输出不携带精确字号/行距/字体等底层样式，
//      故保留 adm-zip 读取 word/styles.xml 提取这些数值。
//   返回的 styles 对象格式与旧实现保持一致，确保 docx-generator.js 能正常消费。
//
// 安全：
//   - magic number 校验：.docx 本质是 ZIP（PK\x03\x04），拒绝伪装文件
//   - zip bomb 防护：限制单个条目解压后大小，防止高压缩比撑爆内存
import mammoth from 'mammoth';
import AdmZip from 'adm-zip';
import fs from 'fs';

// docx 中字号映射（half-points）
const SZ_TO_PT = (sz) => sz / 2;

// ZIP 文件 magic number：PK\x03\x04
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
// 单个条目解压后大小上限（5MB），防 zip bomb
const MAX_ENTRY_SIZE = 5 * 1024 * 1024;

// 校验文件是否为合法 ZIP（docx 本质是 ZIP）
function isZipFile(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return buf.equals(ZIP_MAGIC);
  } catch {
    return false;
  }
}

// mammoth styleMap：将英文/中文标题样式名映射为 h1-h4，便于语义识别
const HEADING_STYLE_MAP = [
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
  "p[style-name='标题 1'] => h1:fresh",
  "p[style-name='标题 2'] => h2:fresh",
  "p[style-name='标题 3'] => h3:fresh",
  "p[style-name='标题 4'] => h4:fresh",
];

// 标题样式候选：styleId 与 styleName（中英文）均兼容
const HEADING_DEFS = [
  { key: 'h1Size', ids: ['Heading1', '1'], names: ['Heading 1', 'heading 1', '标题 1'] },
  { key: 'h2Size', ids: ['Heading2', '2'], names: ['Heading 2', 'heading 2', '标题 2'] },
  { key: 'h3Size', ids: ['Heading3', '3'], names: ['Heading 3', 'heading 3', '标题 3'] },
];

// 读取 styles.xml 中的所有 <w:style> 块，结构化为字段
function extractStyleBlocks(xml) {
  const blocks = [];
  const styleRe = /<w:style\b[^>]*>([\s\S]*?)<\/w:style>/g;
  const idRe = /<w:style\b[^>]*w:styleId="([^"]+)"/;
  let m;
  while ((m = styleRe.exec(xml)) !== null) {
    const full = m[0];
    const inner = m[1];
    const idMatch = full.match(idRe);
    const styleId = idMatch ? idMatch[1] : '';
    const nameMatch = inner.match(/<w:name\s+w:val="([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : '';
    const szMatch = inner.match(/<w:sz\s+w:val="(\d+)"/);
    const sz = szMatch ? parseInt(szMatch[1], 10) : null;
    const fontMatch = inner.match(/<w:rFonts[^>]*w:eastAsia="([^"]+)"/);
    const font = fontMatch ? fontMatch[1] : null;
    const colorMatch = inner.match(/<w:color\s+w:val="([0-9A-Fa-f]{6})"/);
    const color = colorMatch ? colorMatch[1] : null;
    const spacingMatch = inner.match(/<w:spacing[^>]*w:line="(\d+)"[^>]*w:lineRule="([^"]+)"/);
    // lineRule="auto" 时 line 是 240 的倍数（240=1倍）；其余单位为 twips，不计入行距倍数
    const lineSpacing = spacingMatch && spacingMatch[2] === 'auto' ? parseInt(spacingMatch[1], 10) : null;
    blocks.push({ styleId, name, sz, font, color, lineSpacing });
  }
  return blocks;
}

// 在样式块中查找匹配指定 id/name 的样式
function findStyle(blocks, ids, names) {
  const idSet = new Set(ids);
  const nameSet = new Set(names.map((n) => n.toLowerCase()));
  return (
    blocks.find((b) => idSet.has(b.styleId)) ||
    blocks.find((b) => nameSet.has((b.name || '').toLowerCase())) ||
    null
  );
}

// 解析 .docx 模板，返回 { ok, styles } 或 { ok: false, error }
// 注意：mammoth 为异步库，故本函数为 async；调用方需 await
export async function parseTemplate(filePath) {
  // ===== 0. magic number 校验：.docx 本质是 ZIP，拒绝伪装文件 =====
  if (!isZipFile(filePath)) {
    return { ok: false, error: '非法的 docx 文件（非 ZIP 格式）' };
  }

  // ===== 1. mammoth 语义解析：识别标题层级与正文结构 =====
  // mammoth 输出语义化 HTML（h1-h6 / p），但不携带精确字号/行距/字体，
  // 这些底层样式由下方 adm-zip 补充提取。
  let mammothHtml = '';
  try {
    const res = await mammoth.convertToHtml({ path: filePath, styleMap: HEADING_STYLE_MAP });
    mammothHtml = res.value || '';
  } catch (err) {
    // mammoth 解析失败时，仅靠 adm-zip 兜底（见下）
  }

  // ===== 2. adm-zip 补充：读取 word/styles.xml 提取精确字号/行距/字体 =====
  let zip;
  try {
    zip = new AdmZip(filePath);
  } catch {
    return { ok: false, error: '无法读取模板文件' };
  }
  const stylesEntry = zip.getEntry('word/styles.xml');
  if (!stylesEntry) {
    return { ok: false, error: '模板文件缺少 word/styles.xml' };
  }
  // zip bomb 防护：校验条目解压后大小，防止高压缩比撑爆内存
  const entrySize = stylesEntry.header.size || 0;
  if (entrySize > MAX_ENTRY_SIZE) {
    return { ok: false, error: '模板 styles.xml 过大，疑似异常文件' };
  }
  const xml = stylesEntry.getData().toString('utf8');
  // 二次校验：getData 返回的实际长度
  if (xml.length > MAX_ENTRY_SIZE) {
    return { ok: false, error: '模板样式内容过大' };
  }
  const blocks = extractStyleBlocks(xml);

  const result = {
    bodyFont: null,
    bodySize: null,
    bodyLineSpacing: null,
    headingFont: null,
    h1Size: null,
    h2Size: null,
    h3Size: null,
    headingColor: null,
  };

  // 正文默认样式：Normal / 正文
  const normal = findStyle(blocks, ['Normal'], ['Normal', '正文']);
  if (normal) {
    if (normal.font) result.bodyFont = normal.font;
    if (normal.sz) result.bodySize = normal.sz;
    if (normal.lineSpacing) result.bodyLineSpacing = normal.lineSpacing;
  }

  // 标题样式：英文 Heading N 与中文「标题 N」均兼容
  for (const h of HEADING_DEFS) {
    const st = findStyle(blocks, h.ids, h.names);
    if (st) {
      if (st.sz) result[h.key] = st.sz;
      if (!result.headingFont && st.font) result.headingFont = st.font;
      if (!result.headingColor && st.color) result.headingColor = st.color;
    }
  }

  // 过滤 null 字段
  const cleaned = {};
  for (const [k, v] of Object.entries(result)) {
    if (v !== null && v !== undefined) cleaned[k] = v;
  }

  // mammoth 也未能解析出任何内容、且 adm-zip 未识别到样式 → 模板无效
  if (Object.keys(cleaned).length === 0 && !mammothHtml) {
    return { ok: false, error: '未能从模板中识别出有效样式' };
  }
  return { ok: true, styles: cleaned };
}

// 从解析结果中提取预览信息（前端展示用）
export function describeStyles(stylesJson) {
  const lines = [];
  if (stylesJson.bodyFont) lines.push(`正文字体：${stylesJson.bodyFont}`);
  if (stylesJson.bodySize) lines.push(`正文字号：${SZ_TO_PT(stylesJson.bodySize)}pt`);
  if (stylesJson.bodyLineSpacing) {
    const ratio = (stylesJson.bodyLineSpacing / 240).toFixed(1);
    lines.push(`行距：${ratio} 倍`);
  }
  if (stylesJson.headingFont) lines.push(`标题字体：${stylesJson.headingFont}`);
  if (stylesJson.h1Size) lines.push(`一级标题字号：${SZ_TO_PT(stylesJson.h1Size)}pt`);
  if (stylesJson.h2Size) lines.push(`二级标题字号：${SZ_TO_PT(stylesJson.h2Size)}pt`);
  return lines.join(' · ') || '默认学术样式';
}

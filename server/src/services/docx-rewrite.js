// 整篇文档改写服务（降重 / 降AI率）
// 核心原则：保留用户文档格式与图表——仅改写"纯文本正文段落"，
// 标题段落、含图片/图表/嵌入对象/公式的段落、表格、页眉页脚全部原样保留。
//
// 实现：解压 docx → 解析 word/document.xml → 提取可改写段落文本 →
// AI 分批改写（保持段落边界与相近字数）→ 段落文本写回（保留原段落格式与首个 run 样式）→ 重新打包。
import AdmZip from 'adm-zip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { runAI } from '../ai-service.js';
import logger from '../logger.js';

// 单批最大字符数（控制每次 AI 调用长度与质量）
const BATCH_MAX_CHARS = 3000;
// 文档总文本上限（防超大文档拖垮服务）
const MAX_DOC_CHARS = 50000;
// 单段最小长度（过短段落如"摘要"标签、空行保留原样不改写）
const MIN_PARA_CHARS = 20;

const XML_NS = 'http://www.w3.org/XML/1998/namespace';

function elText(node) {
  return node.textContent || '';
}

// 段落是否可改写：
// - 段落样式为标题（Heading/标题/中文 Word 标题样式 ID 1-9）或含大纲级别 → 跳过（保结构）
// - 段落含 drawing（图片/图表）、pict、OLEObject、oMath → 跳过（保图表/公式）
// - 段落含修订痕迹（w:ins/w:del）→ 跳过（避免破坏审阅修订）
function isRewritableParagraph(p) {
  // 标题样式判断
  const pPr = p.getElementsByTagName('w:pPr');
  if (pPr.length > 0) {
    const style = pPr[0].getElementsByTagName('w:pStyle');
    if (style.length > 0) {
      const val = (style[0].getAttribute('w:val') || '').trim().toLowerCase();
      // Heading N / 标题 N / Title / 中文 Word 标题样式 ID（1-9）
      if (/heading|title|标题/.test(val)) return false;
      if (/^[1-9]$/.test(val)) return false;
    }
    // 大纲级别存在 → 视为标题（Word 目录项）
    if (pPr[0].getElementsByTagName('w:outlineLvl').length > 0) return false;
  }
  // 图表/图片/嵌入对象/公式判断
  if (p.getElementsByTagName('w:drawing').length > 0) return false;
  if (p.getElementsByTagName('w:pict').length > 0) return false;
  if (p.getElementsByTagName('o:OLEObject').length > 0) return false;
  if (p.getElementsByTagName('m:oMath').length > 0) return false;
  if (p.getElementsByTagName('m:oMathPara').length > 0) return false;
  // 修订痕迹：跳过，保留审阅批注/修订内容
  if (p.getElementsByTagName('w:ins').length > 0) return false;
  if (p.getElementsByTagName('w:del').length > 0) return false;
  return true;
}

// 从段落提取纯文本（w:t 拼接）
function paragraphText(p) {
  const ts = p.getElementsByTagName('w:t');
  let text = '';
  for (let i = 0; i < ts.length; i++) text += ts[i].textContent || '';
  return text.trim();
}

// 解析文档：返回 { paragraphs: [{node, text, rewritable}] }
export function parseDocxParagraphs(docXml) {
  const doc = new DOMParser().parseFromString(docXml, 'text/xml');
  const bodyEls = doc.getElementsByTagName('w:body');
  if (bodyEls.length === 0) throw new Error('文档结构无效（缺少 w:body）');
  const body = bodyEls[0];
  const paragraphs = [];
  const childNodes = [];
  // 收集 body 的直接子节点（保持顺序）
  for (let i = 0; i < body.childNodes.length; i++) {
    const n = body.childNodes[i];
    if (n.nodeType === 1 && (n.nodeName === 'w:p' || n.nodeName === 'w:tbl')) {
      childNodes.push(n);
    }
  }
  for (const node of childNodes) {
    if (node.nodeName === 'w:p') {
      const text = paragraphText(node);
      const rewritable = isRewritableParagraph(node) && text.length >= MIN_PARA_CHARS;
      paragraphs.push({ node, text, rewritable });
    } else {
      // 表格：整体保留（表格内容不改写）
      paragraphs.push({ node, text: '', rewritable: false, table: true });
    }
  }
  return { doc, paragraphs };
}

// 将改写后的文本写回段落：保留段落 pPr（格式）与首个 run 的 rPr（字体字号），
// 其他 run 删除，文本写入第一个 run 的 w:t（xml:space="preserve" 保留空格）
export function setParagraphText(pNode, newText) {
  const runs = pNode.getElementsByTagName('w:r');
  if (runs.length === 0) {
    // 无 run 的段落：新建一个
    const r = pNode.ownerDocument.createElement('w:r');
    const t = pNode.ownerDocument.createElement('w:t');
    t.setAttribute('xml:space', 'preserve');
    t.appendChild(pNode.ownerDocument.createTextNode(newText));
    r.appendChild(t);
    pNode.appendChild(r);
    return;
  }
  // 保留第一个 run 的结构（含 rPr），清空其 w:t 并写入新文本
  const firstRun = runs[0];
  const firstTs = firstRun.getElementsByTagName('w:t');
  if (firstTs.length > 0) {
    while (firstTs[0].firstChild) firstTs[0].removeChild(firstTs[0].firstChild);
    firstTs[0].setAttribute('xml:space', 'preserve');
    firstTs[0].appendChild(firstRun.ownerDocument.createTextNode(newText));
  } else {
    const t = firstRun.ownerDocument.createElement('w:t');
    t.setAttribute('xml:space', 'preserve');
    t.appendChild(firstRun.ownerDocument.createTextNode(newText));
    firstRun.appendChild(t);
  }
  // 删除其余 run（其内容已被合并改写，保留会造成重复）
  for (let i = runs.length - 1; i >= 1; i--) {
    runs[i].parentNode.removeChild(runs[i]);
  }
}

// 分批：按段落顺序分组，每批 ≤ BATCH_MAX_CHARS
function buildBatches(paragraphs) {
  const batches = [];
  let current = [];
  let currentChars = 0;
  for (const p of paragraphs) {
    if (!p.rewritable) continue;
    if (currentChars + p.text.length > BATCH_MAX_CHARS && current.length > 0) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(p);
    currentChars += p.text.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

// 主流程：改写整篇文档
// tool: 'rewrite'（降重）| 'ai_reduce'（降AI率）
// 返回 { buffer, stats: { totalChars, rewrittenParas, batches } }
export async function rewriteDocxBuffer(inputBuffer, tool) {
  // 1. 解压读取 document.xml
  const zip = new AdmZip(inputBuffer);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) throw new Error('文档缺少 word/document.xml，格式无效');
  let docXml = entry.getData().toString('utf8');
  if (docXml.length > 5 * 1024 * 1024) throw new Error('文档过大（document.xml 超过 5MB）');

  // 2. 解析段落
  const { doc, paragraphs } = parseDocxParagraphs(docXml);
  const rewritable = paragraphs.filter((p) => p.rewritable);
  const totalChars = rewritable.reduce((s, p) => s + p.text.length, 0);
  if (totalChars > MAX_DOC_CHARS) {
    throw new Error(`文档正文过长（最多 ${MAX_DOC_CHARS} 字符，当前 ${totalChars}）`);
  }
  if (rewritable.length === 0) {
    throw new Error('文档中未找到可改写的正文段落（正文不足 20 字的段落将被跳过）');
  }

  // 3. 分批 AI 改写
  const batches = buildBatches(rewritable);
  logger.info('docx-rewrite', `开始改写：${rewritable.length} 段 / ${totalChars} 字符 / ${batches.length} 批`);
  let batchIndex = 0;
  for (const batch of batches) {
    batchIndex++;
    const input = batch.map((p, i) => `[${i + 1}] ${p.text}`).join('\n\n');
    let output = '';
    if (tool === 'rewrite') {
      const r = await runAI('rewrite', { text: input });
      output = r.content || '';
    } else {
      const r = await runAI('ai_reduce', { text: input });
      output = r.content || '';
    }
    // 解析改写结果：按 [n] 标记切回对应段落；解析失败则保留原文（不破坏用户文档）
    const parts = splitRewriteOutput(output, batch.length);
    batch.forEach((p, i) => {
      const newText = (parts[i] || '').trim();
      if (newText && newText.length >= 5) {
        setParagraphText(p.node, newText);
      }
      // 改写失败/过短的段落保持原文
    });
    logger.info('docx-rewrite', `批次 ${batchIndex}/${batches.length} 完成（${batch.length} 段）`);
  }

  // 4. 序列化写回并重新打包
  const serializer = new XMLSerializer();
  const newXml = serializer.serializeToString(doc);
  zip.updateFile('word/document.xml', Buffer.from(newXml, 'utf8'));
  const outBuffer = zip.toBuffer();

  return {
    buffer: outBuffer,
    stats: { totalChars, rewrittenParas: rewritable.length, batches: batches.length, keptCharts: paragraphs.length - rewritable.length },
  };
}

// 解析改写输出：期望格式 "[1] 改写内容 [2] 改写内容"；宽容解析失败返回空数组（调用方保留原文）
export function splitRewriteOutput(output, count) {
  const result = new Array(count).fill('');
  if (!output) return result;
  // 按 [n] 标记切分
  const regex = /\[(\d+)\]([\s\S]*?)(?=\[\d+\]|$)/g;
  let m;
  while ((m = regex.exec(output)) !== null) {
    const idx = parseInt(m[1], 10) - 1;
    if (idx >= 0 && idx < count) {
      result[idx] = (m[2] || '').trim();
    }
  }
  // 若无标记（模型未按格式输出），放弃分段，保留原文
  if (!result.some((r) => r)) return result;
  return result;
}

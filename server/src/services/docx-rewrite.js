// 整篇文档改写服务（降重 / 降AI率）
// 核心原则：保留用户文档格式与图表——仅改写"纯文本正文段落"，
// 标题段落、含图片/图表/嵌入对象/公式的段落、表格、页眉页脚全部原样保留。
//
// 实现：解压 docx → 解析 word/document.xml → 提取可改写段落文本 →
// AI 分批改写（保持段落边界与相近字数）→ 段落文本写回（保留原段落格式与首个 run 样式）→ 重新打包。
import AdmZip from 'adm-zip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { runAI, hasRealAIModel } from '../ai-service.js';
import logger from '../logger.js';

// 单批最大字符数（控制每次 AI 调用长度与质量）
const BATCH_MAX_CHARS = 3000;
// 文档总文本上限（防超大文档拖垮服务）
const MAX_DOC_CHARS = 50000;
// 单段最小长度（过短段落如"摘要"标签、空行保留原样不改写）
const MIN_PARA_CHARS = 20;
// document.xml 解压后大小上限（解压前按 zip 头声明大小预检，防 zip 炸弹）
const MAX_DOCXML_BYTES = 5 * 1024 * 1024;
// zip 条目总数上限：正常 docx 仅几十个条目，海量条目为解压炸弹特征
const MAX_ZIP_ENTRIES = 200;

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
  // 复杂内联结构（超链接/简单域/智能标记）：内部自带 run，整段改写会破坏链接与域代码
  if (p.getElementsByTagName('w:hyperlink').length > 0) return false;
  if (p.getElementsByTagName('w:fldSimple').length > 0) return false;
  if (p.getElementsByTagName('w:smartTag').length > 0) return false;
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
  // 过滤 XML 1.0 非法控制字符：模型输出若混入控制字符会导致 Word 判定文档损坏
  // eslint-disable-next-line no-control-regex -- 字符类刻意匹配控制字符本身
  const safeText = String(newText || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  // 仅取段落直接子级 w:r：避免误改写/误删除 w:hyperlink、w:fldSimple、w:smartTag
  // 等内联结构内部的后代 run（此类段落整体已由 isRewritableParagraph 排除）
  const runs = [];
  for (let i = 0; i < pNode.childNodes.length; i++) {
    const n = pNode.childNodes[i];
    if (n.nodeType === 1 && n.nodeName === 'w:r') runs.push(n);
  }
  if (runs.length === 0) {
    // 无 run 的段落：新建一个
    const r = pNode.ownerDocument.createElement('w:r');
    const t = pNode.ownerDocument.createElement('w:t');
    t.setAttribute('xml:space', 'preserve');
    t.appendChild(pNode.ownerDocument.createTextNode(safeText));
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
    firstTs[0].appendChild(firstRun.ownerDocument.createTextNode(safeText));
  } else {
    const t = firstRun.ownerDocument.createElement('w:t');
    t.setAttribute('xml:space', 'preserve');
    t.appendChild(firstRun.ownerDocument.createTextNode(safeText));
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
// 返回 { buffer, stats: { totalChars, rewrittenParas, batches, failedBatches, keptCharts, usedRealAI } }
// usedRealAI：本次改写实际使用的引擎（true=真实大模型，false=内置模板引擎），
// 供路由响应 engine 字段真实反映；批次开始前按 runAI 同一口径判定，
// 即便所有批次失败仅保留原文，也不会把「调用过 AI 但失败」谎报为内置引擎
export async function rewriteDocxBuffer(inputBuffer, tool) {
  // 1. 解压读取 document.xml
  const zip = new AdmZip(inputBuffer);
  // 解压炸弹防护（解压前预检）：先看 zip 条目总数与 document.xml 头部声明大小，
  // 超限直接拒绝——若先 getData() 全量解压再检查，内存早已被撑爆，检查形同虚设
  if (zip.getEntries().length > MAX_ZIP_ENTRIES) {
    throw new Error(`文档压缩包条目过多（最多 ${MAX_ZIP_ENTRIES} 个）`);
  }
  const entry = zip.getEntry('word/document.xml');
  if (!entry) throw new Error('文档缺少 word/document.xml，格式无效');
  if ((entry.header.size || 0) > MAX_DOCXML_BYTES) {
    throw new Error('文档过大（document.xml 超过 5MB）');
  }
  let docXml = entry.getData().toString('utf8');
  // 头部声明可能谎报（如恶意 zip），解压后二次校验兜底
  if (docXml.length > MAX_DOCXML_BYTES) throw new Error('文档过大（document.xml 超过 5MB）');

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

  // 3. 分批 AI 改写（单批失败仅保留原文，不中断整单）
  const batches = buildBatches(rewritable);
  // 引擎判定（与 runAI 的内置回退口径一致，见 hasRealAIModel）：真实反映本次使用的引擎
  const usedRealAI = hasRealAIModel();
  logger.info('docx-rewrite', `开始改写：${rewritable.length} 段 / ${totalChars} 字符 / ${batches.length} 批`);
  let batchIndex = 0;
  let failedBatches = 0;
  for (const batch of batches) {
    batchIndex++;
    try {
      // 头部指令要求模型按原标记逐段输出，防止段落边界丢失；标记 <<<Pn>>>
      // 与正文中的文献引用 [3] 等方括号写法不冲突（旧 [n] 分隔符会被引用误触发切段）
      const input = [
        '以下段落每段开头均有 <<<Pn>>> 形式的段落标记（n 为段落编号），请逐段改写，输出时在每段开头原样保留对应的段落标记，不要合并、删除段落或改动编号。',
        ...batch.map((p, i) => `<<<P${i + 1}>>> ${p.text}`),
      ].join('\n\n');
      let output = '';
      if (tool === 'rewrite') {
        const r = await runAI('rewrite', { text: input });
        output = r.content || '';
      } else {
        const r = await runAI('ai_reduce', { text: input });
        output = r.content || '';
      }
      // 解析改写结果：按 <<<Pn>>> 标记切回对应段落；解析失败则保留原文（不破坏用户文档）
      const parts = splitRewriteOutput(output, batch.length);
      batch.forEach((p, i) => {
        const newText = (parts[i] || '').trim();
        if (newText && newText.length >= 5) {
          setParagraphText(p.node, newText);
        }
        // 改写失败/过短的段落保持原文
      });
      logger.info('docx-rewrite', `批次 ${batchIndex}/${batches.length} 完成（${batch.length} 段）`);
    } catch (err) {
      // 单批失败不抛出：该批段落保留原文，整单继续（此前整单丢弃会浪费已成功的批次与费用）
      failedBatches++;
      logger.error('docx-rewrite', `批次 ${batchIndex}/${batches.length} 失败，该批保留原文: ${err.message}`);
    }
  }

  // 4. 序列化写回并重新打包
  const serializer = new XMLSerializer();
  let newXml = serializer.serializeToString(doc);
  // 补 XML 声明：xmldom 序列化不携带声明，缺失会被部分 Word 版本判定为无效文档
  if (!newXml.startsWith('<?xml')) {
    newXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${newXml}`;
  }
  zip.updateFile('word/document.xml', Buffer.from(newXml, 'utf8'));
  const outBuffer = zip.toBuffer();

  return {
    buffer: outBuffer,
    stats: { totalChars, rewrittenParas: rewritable.length, batches: batches.length, failedBatches, keptCharts: paragraphs.length - rewritable.length, usedRealAI },
  };
}

// 解析改写输出：期望格式 "<<<P1>>> 改写内容 <<<P2>>> 改写内容"；宽容解析失败返回空数组（调用方保留原文）
export function splitRewriteOutput(output, count) {
  const result = new Array(count).fill('');
  if (!output) return result;
  // 按 <<<Pn>>> 标记切分（每处调用新建正则，避免 /g 的 lastIndex 状态跨调用残留）。
  // 注意标记为三个 '>'：匹配段须写 >>>，漏写一个会把第三个 '>' 残留进段落正文
  const regex = /<<<P(\d+)>>>([\s\S]*?)(?=<<<P\d+>>>|$)/g;
  let m;
  while ((m = regex.exec(output)) !== null) {
    const idx = parseInt(m[1], 10) - 1;
    // 编号须在合理范围内，越界编号忽略
    if (idx >= 0 && idx < count) {
      result[idx] = (m[2] || '').trim();
    }
  }
  // 若无标记（模型未按格式输出），放弃分段，保留原文
  if (!result.some((r) => r)) return result;
  return result;
}

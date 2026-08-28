// docx 整篇改写（降重/降AI率）单元 + 端到端测试
// 核心保证：仅改写正文段落，标题/图表/表格/公式原样保留，段落格式与首个 run 样式不丢失。
// 使用临时 DB（DB_PATH），无真实 AI Key 时走内置模板引擎（同义替换），可确定性断言。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { DOMParser } from '@xmldom/xmldom';

// 必须在 import 业务模块前设置 DB_PATH（db.js 在模块加载时读环境变量）
const tmpDir = mkdtempSync(join(tmpdir(), 'sf-docx-'));
process.env.DB_PATH = join(tmpDir, 'test.db');

const { parseDocxParagraphs, setParagraphText, splitRewriteOutput, rewriteDocxBuffer } = await import('../src/services/docx-rewrite.js');
const { default: db } = await import('../src/db.js');

after(() => {
  try { db.close(); } catch { /* already closed */ }
  rmSync(tmpDir, { recursive: true, force: true });
});

// xmldom NodeList 不可迭代，转数组
const toArray = (nl) => Array.prototype.slice.call(nl);

// 模拟 Word 文档 XML：中文标题（样式 ID "1"）、正文（样式 "a3" + 首个 run 带 rPr）、
// 无样式正文、图表（w:drawing）、表格（w:tbl）、公式（m:oMath）、超短段落、大纲级别段落
const DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>第一章 绪论</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="a3"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr><w:t>近年来，深度学习技术发展迅速，广泛应用于图像识别领域，通过大量实验分析发现该方法显著提升了识别准确率。</w:t></w:r></w:p>
    <w:p><w:r><w:t>虽然数据量有限，但是该方法依然有效，因此可以认为结果可靠。</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="2"/></w:pPr><w:r><w:t>1.1 研究背景</w:t></w:r></w:p>
    <w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId4"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>表1 实验结果对比数据</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><m:oMath><m:r><m:t>E=mc^2</m:t></m:r></m:oMath></w:p>
    <w:p><w:r><w:t>短</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>
  </w:body>
</w:document>`;

function makeZip(docXml = DOC_XML) {
  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from(docXml, 'utf8'));
  return zip.toBuffer();
}

test('parseDocxParagraphs：正确识别可改写/保留段落', () => {
  const { paragraphs } = parseDocxParagraphs(DOC_XML);
  const byText = (t) => paragraphs.find((p) => p.text.includes(t));

  // 中文 Word 标题样式 ID "1"/"2" → 不可改写
  assert.equal(byText('第一章 绪论').rewritable, false);
  assert.equal(byText('1.1 研究背景').rewritable, false);
  // 正文段落 → 可改写
  assert.equal(byText('近年来，深度学习').rewritable, true);
  assert.equal(byText('虽然数据量有限').rewritable, true);
  // 图表段落 → 保留
  assert.equal(paragraphs.find((p) => p.node.getElementsByTagName('w:drawing').length > 0).rewritable, false);
  // 表格 → 整体保留
  assert.equal(paragraphs.find((p) => p.table).rewritable, false);
  // 公式段落 → 保留
  assert.equal(paragraphs.find((p) => p.node.getElementsByTagName('m:oMath').length > 0).rewritable, false);
  // 超短段落 → 不改写
  assert.equal(byText('短').rewritable, false);
});

test('setParagraphText：写回文本并保留 pPr 与首个 run 的 rPr，删除多余 run', () => {
  const doc = new DOMParser().parseFromString(DOC_XML, 'text/xml');
  const paras = doc.getElementsByTagName('w:p');
  const target = toArray(paras).find((p) => p.textContent.includes('近年来'));
  // 追加第二个 run 模拟多 run 段落
  const extraRun = doc.createElement('w:r');
  const extraT = doc.createElement('w:t');
  extraT.appendChild(doc.createTextNode('（多余 run）'));
  extraRun.appendChild(extraT);
  target.appendChild(extraRun);
  assert.equal(target.getElementsByTagName('w:r').length, 2);

  setParagraphText(target, '改写后的新内容，长度足够。');

  // 文本替换完成
  assert.equal(target.textContent, '改写后的新内容，长度足够。');
  // 只保留一个 run
  assert.equal(target.getElementsByTagName('w:r').length, 1);
  // pPr（正文样式）保留
  const pStyle = target.getElementsByTagName('w:pStyle')[0];
  assert.equal(pStyle.getAttribute('w:val'), 'a3');
  // 首个 run 的 rPr（字体/字号）保留
  const firstRun = target.getElementsByTagName('w:r')[0];
  assert.equal(firstRun.getElementsByTagName('w:rFonts')[0].getAttribute('w:ascii'), 'Times New Roman');
  assert.equal(firstRun.getElementsByTagName('w:sz')[0].getAttribute('w:val'), '24');
});

test('splitRewriteOutput：按 <<<Pn>>> 标记分段解析', () => {
  assert.deepEqual(splitRewriteOutput('<<<P1>>> 第一段改写 <<<P2>>> 第二段改写', 2), ['第一段改写', '第二段改写']);
  // 正文含文献引用编号 [3] 时不得被误当分隔符（旧版 [n] 方案的高危缺陷）
  assert.deepEqual(splitRewriteOutput('<<<P1>>> 文献[3]提出的方法与[12]的对比 <<<P2>>> 另一段', 2), [
    '文献[3]提出的方法与[12]的对比',
    '另一段'
  ]);
  // 越界编号忽略
  assert.deepEqual(splitRewriteOutput('<<<P1>>> 甲 <<<P5>>> 越界', 2), ['甲', '']);
  // 无标记输出 → 全部为空（调用方保留原文）
  assert.deepEqual(splitRewriteOutput('模型没有按格式输出', 2), ['', '']);
  // 空输出 → 空数组
  assert.deepEqual(splitRewriteOutput('', 2), ['', '']);
});

test('rewriteDocxBuffer 端到端：仅改写正文，标题/图表/表格/公式/格式原样保留', async () => {
  const { buffer, stats } = await rewriteDocxBuffer(makeZip(), 'rewrite');

  assert.ok(stats.rewrittenParas >= 1, '至少改写一段正文');
  assert.ok(stats.keptCharts >= 1, '保留段落计数正确');

  // 输出仍是合法 docx（能解压并解析 document.xml）
  const outZip = new AdmZip(buffer);
  const outXml = outZip.getEntry('word/document.xml').getData().toString('utf8');
  const outDoc = new DOMParser().parseFromString(outXml, 'text/xml');
  const outParas = toArray(outDoc.getElementsByTagName('w:p'));
  const textOf = (p) => (p.textContent || '').trim();

  // 标题原样保留
  const heading = outParas.find((p) => textOf(p) === '第一章 绪论');
  assert.ok(heading, '标题保留');
  assert.equal(heading.getElementsByTagName('w:pStyle')[0].getAttribute('w:val'), '1');
  // 二级标题保留
  assert.ok(outParas.some((p) => textOf(p) === '1.1 研究背景'), '二级标题保留');

  // 图表、表格、公式数量不变（原样保留）
  assert.equal(outDoc.getElementsByTagName('w:drawing').length, 1, '图表保留');
  assert.equal(outDoc.getElementsByTagName('w:tbl').length, 1, '表格保留');
  assert.equal(outDoc.getElementsByTagName('m:oMath').length, 1, '公式保留');
  assert.equal(outDoc.getElementsByTagName('w:tbl')[0].textContent.trim(), '表1 实验结果对比数据', '表格内容不变');

  // 正文段落被改写（内置引擎同义替换），且 [n] 标记被剥离
  const paraA = outParas.find((p) => textOf(p).includes('近些年来'));
  assert.ok(paraA, '正文段落一被改写');
  assert.ok(!textOf(paraA).includes('[1]'), '编号标记已剥离');
  assert.equal(paraA.getElementsByTagName('w:pStyle')[0].getAttribute('w:val'), 'a3', '正文样式保留');
  const firstRun = paraA.getElementsByTagName('w:r')[0];
  assert.equal(firstRun.getElementsByTagName('w:rFonts')[0].getAttribute('w:ascii'), 'Times New Roman', '正文字体保留');
  assert.equal(firstRun.getElementsByTagName('w:sz')[0].getAttribute('w:val'), '24', '正文字号保留');

  const paraB = outParas.find((p) => textOf(p).includes('尽管') && textOf(p).includes('数据量'));
  assert.ok(paraB, '正文段落二被改写');
  assert.ok(!textOf(paraB).includes('[2]'), '编号标记已剥离');
  assert.ok(textOf(paraB).includes('切实'), '同义替换生效（有效→切实）');

  // 超短段落原样
  assert.ok(outParas.some((p) => textOf(p) === '短'), '超短段落保留');
});

test('rewriteDocxBuffer：ai_reduce 模式同样保留图表与结构', async () => {
  const { buffer } = await rewriteDocxBuffer(makeZip(), 'ai_reduce');
  const outZip = new AdmZip(buffer);
  const outXml = outZip.getEntry('word/document.xml').getData().toString('utf8');
  const outDoc = new DOMParser().parseFromString(outXml, 'text/xml');
  assert.equal(outDoc.getElementsByTagName('w:drawing').length, 1, '图表保留');
  assert.equal(outDoc.getElementsByTagName('w:tbl').length, 1, '表格保留');
  assert.equal(outDoc.getElementsByTagName('m:oMath').length, 1, '公式保留');
  assert.ok(toArray(outDoc.getElementsByTagName('w:p')).some((p) => (p.textContent || '').trim() === '第一章 绪论'), '标题保留');
});

test('rewriteDocxBuffer：无正文段落时报错', async () => {
  const emptyDoc = DOC_XML
    .replace(/<w:p><w:pPr><w:pStyle w:val="a3"\/><\/w:pPr>[\s\S]*?<\/w:p>/, '')
    .replace(/<w:p><w:r><w:t>虽然[\s\S]*?<\/w:r><\/w:p>/, '');
  await assert.rejects(() => rewriteDocxBuffer(makeZip(emptyDoc), 'rewrite'), /可改写的正文段落/);
});

test('rewriteDocxBuffer：缺少 document.xml 报错', async () => {
  const zip = new AdmZip();
  zip.addFile('other.txt', Buffer.from('x'));
  await assert.rejects(() => rewriteDocxBuffer(zip.toBuffer(), 'rewrite'), /document\.xml/);
});

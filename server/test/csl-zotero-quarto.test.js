// csl-formatter / zotero-client / quarto-exporter 契约测试
import { test } from 'node:test';
import assert from 'node:assert';
import {
  formatReferencesWithCsl,
  formatReferencesGBWithCsl,
  isCslAvailable,
} from '../src/services/csl-formatter.js';
import {
  isZoteroConfigured,
  searchByIdentifier,
  importBibliography,
} from '../src/services/zotero-client.js';
import {
  isQuartoConfigured,
  exportDocument,
  normalizeFormat,
} from '../src/services/quarto-exporter.js';

const refs = [
  { title: 'Deep Residual Learning for Image Recognition', authors: 'Kaiming He, Xiangyu Zhang, Shaoqing Ren, Jian Sun', year: '2016', journal: 'CVPR', doi: '10.1109/CVPR.2016.90', pages: '770-778', item_type: 'conference' },
  { title: '注意力机制研究综述', authors: '张三, 李四', year: '2020', journal: '计算机学报', volume: '43', issue: '5', pages: '1000-1020', item_type: 'journal' },
  { title: '统计学习方法', authors: '李航', year: '2019', item_type: 'book' },
];

test('isCslAvailable 在 citation-js 已安装时应为 true', () => {
  assert.equal(isCslAvailable(), true);
});

test('formatReferencesWithCsl 用官方 GB/T 7714 样式产出文献类型标识与编号', async () => {
  const { text, style } = await formatReferencesWithCsl(refs);
  assert.equal(style, 'gb-t-7714-2015-numeric');
  // 期刊 [J]、专著 [M]、会议 [C]，编号 [n]
  assert.match(text, /\[1\]/);
  assert.match(text, /\[2\].*\[J\]/);
  assert.match(text, /\[3\].*\[M\]/);
  // 会议论文带 DOI 应为 [C/OL]
  assert.match(text, /\[C\/OL\]/);
});

test('formatReferencesWithCsl 超过 3 个作者用「等」缩写', async () => {
  const { text } = await formatReferencesWithCsl(refs);
  // 4 个作者 → 前 3 个 + 等（et-al-min=4, et-al-use-first=3）
  assert.match(text, /等\. Deep Residual/);
});

test('formatReferencesGBWithCsl 不再二次加编号（无 [1] [1] 重复）', async () => {
  const text = await formatReferencesGBWithCsl(refs);
  assert.doesNotMatch(text, /\[1\] \[1\]/);
  assert.match(text, /^\[1\] /);
  assert.equal(text.split('\n').length, 3);
});

test('空参考文献返回空串', async () => {
  const { text } = await formatReferencesWithCsl([]);
  assert.equal(text, '');
});

test('zotero 未配置时 isZoteroConfigured 为 false，调用抛错（不静默）', async () => {
  // 测试环境通常未设置 ZOTERO_TRANSLATION_URL
  assert.equal(isZoteroConfigured(), false);
  await assert.rejects(() => searchByIdentifier('10.1000/xyz'), /未配置 ZOTERO_TRANSLATION_URL/);
  await assert.rejects(() => importBibliography('@book{x}'), /未配置 ZOTERO_TRANSLATION_URL/);
});

test('quarto 未配置时 isQuartoConfigured 为 false，exportDocument 抛错', async () => {
  // 测试环境通常未设置 QUARTO_BIN / PANDOC_BIN
  assert.equal(isQuartoConfigured(), false);
  await assert.rejects(
    () => exportDocument('/tmp/in.md', '/tmp/out.docx', { format: 'docx' }),
    /未配置 QUARTO_BIN 或 PANDOC_BIN/
  );
});

test('normalizeFormat 拒绝非法格式', () => {
  assert.throws(() => normalizeFormat('exe'), /不支持的导出格式/);
  assert.equal(normalizeFormat('DOCX'), 'docx');
  assert.equal(normalizeFormat('pdf'), 'pdf');
});

// 多源检索（arXiv ATOM 解析）与 MinerU 表格解析纯函数单元测试
// 在 import 模块前设置临时 DB 路径，避免污染生产数据库（db.js 支持 DB_PATH）
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

const { parseArxivAtom } = await import('../src/services/multi-source-search.js');
const { htmlTableToRows, tablesFromMinerUData } = await import('../src/services/paper-distillation.js');

const ARXIV_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00001v2</id>
    <updated>2024-01-15T00:00:00Z</updated>
    <published>2024-01-05T00:00:00Z</published>
    <title>Deep Learning\n  for Medical Image Segmentation</title>
    <summary>  We propose a novel method achieving accuracy of 95.2%\n and F1 score of 0.93.  </summary>
    <author><name>Alice Zhang</name></author>
    <author><name>Bob Li</name></author>
    <link href="http://arxiv.org/abs/2401.00001v2" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/2401.00001v2" rel="related" type="application/pdf"/>
  </entry>
</feed>`;

test('parseArxivAtom：解析标题/作者/年份/摘要/PDF 链接', () => {
  const papers = parseArxivAtom(ARXIV_FIXTURE);
  assert.equal(papers.length, 1, '应解析出 1 篇论文');
  const p = papers[0];
  assert.equal(p.title, 'Deep Learning for Medical Image Segmentation', '标题应清理换行与多余空格');
  assert.equal(p.year, '2024', '年份应取自 published');
  assert.ok(p.authors.includes('Alice Zhang'), '应包含作者');
  assert.equal(p.journal, 'arXiv', 'journal 应为 arXiv');
  assert.equal(p.source_db, 'arXiv', 'source_db 应为 arXiv');
  assert.equal(p.pdf_url, 'https://arxiv.org/pdf/2401.00001v2', 'pdf 链接应归一化为 https（防下游 ^https:// 过滤剔除 arXiv 主来源）');
  assert.ok(p.source_url.includes('arxiv.org/abs/'), 'source_url 应为 abs 链接');
  assert.ok(p.abstract.includes('95.2%'), '摘要应保留');
});

test('parseArxivAtom：无 entry 的 feed 返回空数组', () => {
  const papers = parseArxivAtom('<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
  assert.deepEqual(papers, [], '空 feed 应返回空数组');
});

test('htmlTableToRows：HTML 表格解析为二维数组', () => {
  const html = '<table><tr><td>Method</td><td>Accuracy</td></tr><tr><td>Ours</td><td>95.2</td></tr></table>';
  const rows = htmlTableToRows(html);
  assert.equal(rows.length, 2, '应有 2 行');
  assert.deepEqual(rows[0], ['Method', 'Accuracy'], '表头解析正确');
  assert.deepEqual(rows[1], ['Ours', '95.2'], '数据行解析正确');
});

test('tablesFromMinerUData：从 content_list 提取表格并忽略非表格项', () => {
  const data = {
    results: {
      content_list: [
        { type: 'text', text: '正文段落' },
        { type: 'table', table_body: '<table><tr><td>A</td><td>1</td></tr><tr><td>B</td><td>2</td></tr></table>' },
        { type: 'image', img_path: 'images/x.png' },
      ],
    },
  };
  const tables = tablesFromMinerUData(data);
  assert.equal(tables.length, 1, '应提取 1 张表');
  assert.deepEqual(tables[0][0], ['A', '1'], '表格内容正确');
});

test('tablesFromMinerUData：兼容顶层 content_list 与空数据', () => {
  assert.deepEqual(tablesFromMinerUData({ content_list: [] }), [], '空 content_list 返回空数组');
  assert.deepEqual(tablesFromMinerUData({}), [], '缺字段返回空数组');
});

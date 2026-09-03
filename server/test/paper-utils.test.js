// 纯函数单元测试：引用/图表占位符替换、参考文献格式化、benchmark 提取与图表配置
// 在 import 模块前设置临时 DB 路径，避免污染生产数据库（db.js 支持 DB_PATH）
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

const {
  replaceCitePlaceholders,
  replaceChartPlaceholders,
  formatReferencesGB,
  benchmarksToChartConfig,
  extractBenchmarkData,
  ensureGroundedVisuals,
  filterVerifiedWritingReferences,
} = await import('../src/services/paper-distillation.js');

test('replaceCitePlaceholders：正常替换 [CITE:n] 并追加参考文献列表', () => {
  const refs = [
    { title: 'Test Paper', authors: 'Zhang S, Li H', journal: 'IEEE TPAMI', year: '2023', doi: '10.1/x', doi_verified: true, source_db: 'CrossRef', source_url: 'https://doi.org/10.1/x' },
  ];
  const out = replaceCitePlaceholders('本文方法[CITE:1]有效。', refs);
  assert.ok(out.includes('[1]'), '应替换为 [1]');
  assert.ok(!out.includes('CITE'), '不应残留 CITE 占位符');
  assert.ok(out.includes('## 参考文献'), '应追加参考文献标题');
  assert.ok(out.includes('Test Paper'), '参考文献列表应含真实标题');
});

test('replaceCitePlaceholders：删除模型编造的文献表并用核验白名单重建', () => {
  const refs = [{ title: 'Real Paper', authors: 'A', year: '2024', doi: '10.1/real', doi_verified: true, source_db: 'CrossRef', source_url: 'https://doi.org/10.1/real' }];
  const out = replaceCitePlaceholders('正文[CITE:1]\n\n## 参考文献\n\n1. 张三. 虚构论文[J]. 虚构期刊, 2022.', refs);
  assert.ok(out.includes('Real Paper'));
  assert.ok(!out.includes('张三'));
  assert.ok(!out.includes('虚构期刊'));
});

test('filterVerifiedWritingReferences：拒绝不受信来源和 DOI 标题核验失败记录', () => {
  const safe = { title: 'Safe', source_db: 'OpenAlex', source_url: 'https://openalex.org/W1' };
  assert.deepEqual(filterVerifiedWritingReferences([
    safe,
    { ...safe, title: 'Mismatch', doi_verified: false },
    { title: 'Manual fake', source_db: 'manual', source_url: 'https://example.com/fake' },
  ]), [safe]);
});

test('ensureGroundedVisuals：实验章节自动补入至少两张真实指标图和来源表', () => {
  const benchmarks = [
    { paperTitle: 'Paper A', source_db: 'OpenAlex', metrics: [{ label: '准确率', value: 91 }, { label: 'F1', value: 89 }] },
    { paperTitle: 'Paper B', source_db: 'CrossRef', metrics: [{ label: '准确率', value: 88 }, { label: 'F1', value: 86 }] },
  ];
  const tables = [{ source: 'Paper A', year: 2024, source_url: 'https://openalex.org/W1', rows: [['方法', '准确率'], ['A', '91'], ['B', '88']] }];
  const out = ensureGroundedVisuals('## 实验结果', { benchmarks, tables }, '第四章 实验与结果分析');
  assert.equal((out.match(/```vega/g) || []).length, 2);
  assert.ok(out.includes('数据引自：Paper A'));
  assert.ok(out.includes('| 方法 | 准确率 |'));
});

test('ensureGroundedVisuals：没有实验指标时用真实文献元数据补足图表并删除示例数值', () => {
  const references = [2022, 2023, 2024].map((year, i) => ({
    title: `Real Paper ${i}`, year, source_db: 'OpenAlex', source_url: `https://openalex.org/W${i}`,
    cited_by_count: 10 + i,
  }));
  const example = '结果如下（示例数据，请替换为真实数据）：\n\n| 方法 | 准确率 | F1 |\n| --- | --- | --- |\n| A | 99 | 98 |\n\n注：以上是示例数据，请替换为真实数据。';
  const out = ensureGroundedVisuals(example, { references }, '第四章 实验结果');
  assert.equal((out.match(/```vega/g) || []).length, 2);
  assert.ok(out.includes('真实参考论文汇总'));
  assert.ok(!out.includes('| A | 99 | 98 |'));
});

test('replaceCitePlaceholders：越界引用被移除', () => {
  const refs = [{ title: 'T', authors: 'A', journal: '', year: '', doi: '' }];
  const out = replaceCitePlaceholders('引用[CITE:9]测试', refs);
  assert.ok(!out.includes('[9]'), '越界引用应被移除');
  assert.ok(!out.includes('CITE'), '不应残留 CITE 占位符');
});

test('replaceCitePlaceholders：无参考文献时移除占位符', () => {
  const out = replaceCitePlaceholders('内容[CITE:1]', null);
  assert.equal(out, '内容', '无参考文献时应移除 [CITE:n] 占位符');
});

test('replaceChartPlaceholders：无数据时标注「数据待补充」', () => {
  const out = replaceChartPlaceholders('结果[CHART:F1]如下', []);
  assert.ok(out.includes('（数据待补充）'), '无数据应标注');
  assert.ok(!out.includes('CHART'), '不应残留 CHART 占位符');
});

test('replaceChartPlaceholders：有数据时生成 vega 代码块', () => {
  const benchmarks = [{ paperTitle: 'A', paperYear: '2023', metrics: [{ label: '准确率', value: 92.3 }] }];
  const out = replaceChartPlaceholders('对比[CHART:准确率]', benchmarks);
  assert.ok(out.includes('```vega'), '应生成 vega 代码块');
  assert.ok(out.includes('92.3'), '应包含真实数值');
});

test('formatReferencesGB：空期刊字段不产生残缺格式', () => {
  const out = formatReferencesGB([{ title: 'Solo Paper', authors: 'A B', journal: '', year: '2024', doi: '' }]);
  assert.ok(out.includes('A B. Solo Paper. 2024.'), '空期刊时应简洁拼接');
  assert.ok(!out.includes('[J]. ,'), '不应出现残缺 [J]. , 片段');
});

test('benchmarksToChartConfig：命中指标生成配置，缺失返回 null', () => {
  const benchmarks = [{ paperTitle: 'A', paperYear: '2023', metrics: [{ label: '准确率', value: 92.3 }] }];
  const cfg = benchmarksToChartConfig(benchmarks, '准确率');
  assert.ok(cfg && cfg.mark === 'bar', '应生成柱状图配置');
  assert.equal(cfg.data.values[0].value, 92.3);
  assert.equal(benchmarksToChartConfig(benchmarks, 'F1'), null, '无 F1 指标应返回 null');
  assert.equal(benchmarksToChartConfig([], '准确率'), null, '空数据应返回 null');
});

test('extractBenchmarkData：从摘要提取性能指标', () => {
  const papers = [
    { title: 'P', abstract: 'Our method achieves accuracy of 92.3% and F1 score of 0.91.', year: '2023' },
  ];
  const bms = extractBenchmarkData(papers);
  assert.ok(bms.length >= 1, '应提取到 benchmark');
  assert.ok(bms[0].metrics.some((m) => m.label === '准确率'), '应含准确率指标');
  assert.equal(bms[0].paperTitle, 'P');
});

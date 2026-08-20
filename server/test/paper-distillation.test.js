// 数据套用引擎纯函数单元测试：指标提取 / 表格行提取 / benchmark 图表配置 / 框架上下文
// 在 import 模块前设置临时 DB 路径，避免污染生产数据库（db.js 支持 DB_PATH）
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

const {
  extractMetricsFromText,
  extractDataTables,
  extractBenchmarkData,
  benchmarksToChartConfig,
  buildFrameworkContext,
} = await import('../src/services/paper-distillation.js');

test('extractMetricsFromText：识别中英文指标并归一化 0-100', () => {
  const metrics = extractMetricsFromText('Our method achieves accuracy of 92.3% and F1 score of 0.91. IoU达到0.85，Dice coefficient of 88%');
  assert.ok(metrics.some((m) => m.label === '准确率' && m.value === 92.3), '应提取 accuracy 92.3');
  assert.ok(metrics.some((m) => m.label === 'F1' && m.value === 91), 'F1 0.91 应归一化为 91');
  assert.ok(metrics.some((m) => m.label === 'IoU' && m.value === 85), 'IoU 0.85 应归一化为 85');
  assert.ok(metrics.some((m) => m.label === 'Dice' && m.value === 88), '应提取 Dice 88');
});

test('extractDataTables：连续数值行组成表格并保留来源', () => {
  const lines = [
    '本文提出了一种新方法。',
    'Method  Accuracy  F1  Time',
    'Ours  92.3  0.91  12',
    'Baseline  85.1  0.83  8',
    'Old  80.2  0.79  6',
    '结论部分讨论了未来工作。',
  ];
  const tables = extractDataTables(lines, { title: 'Test Paper', year: '2023', source_url: 'https://example.org' });
  assert.ok(tables.length >= 1, '应提取到至少 1 张表');
  assert.equal(tables[0].source, 'Test Paper', '表应保留来源论文标题');
  assert.ok(tables[0].rows.length >= 3, '表格应包含 3 行数据');
});

test('extractBenchmarkData：无摘要数据的论文不产生 benchmark', () => {
  const bms = extractBenchmarkData([{ title: 'T', abstract: 'This paper introduces a framework without numbers.' }]);
  assert.equal(bms.length, 0, '无指标数字不应产生 benchmark');
});

test('benchmarksToChartConfig：来源标注包含在标题中', () => {
  const benchmarks = [{ paperTitle: 'A', paperYear: '2023', metrics: [{ label: '准确率', value: 92.3 }] }];
  const cfg = benchmarksToChartConfig(benchmarks, '准确率');
  assert.ok(cfg, '应生成图表配置');
  assert.ok(cfg.title.includes('数据'), '标题应体现数据来源标注');
  assert.equal(cfg.data.values[0].value, 92.3);
});

test('buildFrameworkContext：兼容持久化 framework（无 papers 数组）', () => {
  const framework = {
    methods: ['方法A', '方法B'],
    innovations: ['创新点1'],
    conclusions: ['结论1'],
    paperCount: 8,
    sources_used: ['OpenAlex', 'CrossRef'],
  };
  const ctx = buildFrameworkContext(framework, []);
  assert.ok(ctx.includes('共参考 8 篇'), '应包含论文数量');
  assert.ok(ctx.includes('OpenAlex'), '应包含数据源');
  assert.ok(ctx.includes('方法A'), '应包含研究方法');
});

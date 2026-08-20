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
  discoverPerspectives,
  outlineTextToStructure,
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

test('buildFrameworkContext：包含视角分组展示', () => {
  const framework = {
    methods: ['方法A'],
    innovations: [],
    conclusions: [],
    paperCount: 4,
    sources_used: ['arXiv'],
    perspectives: [{ view: '数据集与实验基准', methods: ['基准数据集'], innovations: [] }],
  };
  const ctx = buildFrameworkContext(framework, []);
  assert.ok(ctx.includes('研究视角与方法分布'), '应包含视角分组标题');
  assert.ok(ctx.includes('数据集与实验基准'), '应包含视角名称');
});

test('discoverPerspectives：无真实 AI 时返回默认视角列表', async () => {
  const views = await discoverPerspectives('测试主题', '计算机科学', { promptTokens: 0, completionTokens: 0 });
  assert.ok(Array.isArray(views) && views.length >= 3, '应返回至少 3 个默认视角');
});

test('outlineTextToStructure：markdown 格式（## 章节 + ### 小节）', () => {
  const md = [
    '# 论文题目',
    '## 第一章 绪论',
    '### 1.1 研究背景与意义',
    '### 1.2 国内外研究现状',
    '## 第二章 研究方法',
    '### 2.1 模型设计',
    '参考文献',
  ].join('\n');
  const s = outlineTextToStructure(md);
  assert.equal(s.length, 2, '应解析出 2 章');
  assert.equal(s[0].chapter, '第一章 绪论');
  assert.equal(s[0].sections.length, 2);
  assert.equal(s[0].sections[0].title, '1.1 研究背景与意义');
});

test('outlineTextToStructure：内置模板格式（一、章节 + 缩进数字小节）', () => {
  const tpl = [
    '一、引言',
    '  1.1 深度学习的研究背景与意义',
    '  1.2 国内外研究现状综述',
    '',
    '二、相关理论与技术基础',
    '  2.1 核心概念界定',
  ].join('\n');
  const s = outlineTextToStructure(tpl);
  assert.equal(s.length, 2, '应解析出 2 章');
  assert.equal(s[0].chapter, '一、引言');
  assert.equal(s[0].sections.length, 2);
  assert.equal(s[1].chapter, '二、相关理论与技术基础');
});

test('outlineTextToStructure：第X章格式与（1）小节', () => {
  const t = [
    '第一章 绪论',
    '1.1 背景',
    '（2）意义',
    '第二章 方法',
    '2.1 模型',
  ].join('\n');
  const s = outlineTextToStructure(t);
  assert.equal(s.length, 2);
  assert.equal(s[0].sections.length, 2, '（2）应解析为小节');
  assert.equal(s[0].sections[1].title, '（2）意义');
});

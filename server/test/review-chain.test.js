// 审校链纯函数单元测试：规则审校（引用一致性/占位符残留/结构提示）+ AI 审校结论解析
// 在 import 模块前设置临时 DB 路径，避免污染生产数据库（db.js 支持 DB_PATH）
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

const { ruleReview, parseReviewVerdict } = await import('../src/services/review-chain.js');

const cleanPaper = `# 基于深度学习的图像分割研究

## 1 引言
近年来深度学习发展迅速[1]，图像分割取得显著进展[2]。

## 2 方法
本文提出一种改进的分割网络[3]，结合注意力机制[1]。

## 3 结论
实验表明本方法优于基线[2]。

## 参考文献

[1] 作者A. 论文一. 期刊, 2023.
[2] 作者B. 论文二. 期刊, 2022.
[3] 作者C. 论文三. 期刊, 2021.`;

test('ruleReview：引用编号与参考文献一一对应时无错误', () => {
  const { errors } = ruleReview(cleanPaper);
  assert.equal(errors.length, 0, '干净论文不应有硬错误');
});

test('ruleReview：引用越界检出为硬错误（触发修订）', () => {
  const bad = cleanPaper.replace('结合注意力机制[1]', '结合注意力机制[7]');
  const { errors } = ruleReview(bad);
  assert.ok(errors.some((e) => e.type === 'citation' && e.detail.includes('[7]')), '应检出越界引用 [7]');
});

test('ruleReview：正文引用扫描不误伤参考文献列表自身编号', () => {
  // 参考文献列表每行以 [n] 开头，不属于正文引用；3 条文献 + 正文引 [1][2][3] 应无错误
  const { errors } = ruleReview(cleanPaper);
  assert.equal(errors.filter((e) => e.type === 'citation').length, 0);
});

test('ruleReview：占位符残留检出为硬错误', () => {
  const dirty = `## 1 引言
本文提出一种方法，如[CITE:3]所示，效果见[CHART:准确率]与【图表1】（数据待补充）。

## 参考文献

[1] 作者A. 论文一. 期刊, 2023.`;
  const { errors } = ruleReview(dirty);
  assert.ok(errors.some((e) => e.type === 'placeholder' && e.detail.includes('[CITE:n]')), '应检出 CITE 占位符');
  assert.ok(errors.some((e) => e.type === 'placeholder' && e.detail.includes('[CHART:...]')), '应检出 CHART 占位符');
  assert.ok(errors.some((e) => e.type === 'placeholder' && e.detail.includes('图表占位标记')), '应检出图表占位标记');
  assert.ok(errors.some((e) => e.type === 'placeholder' && e.detail.includes('数据待补充')), '应检出数据待补充');
});

test('ruleReview：未引用文献为软提示不触发修订', () => {
  const { errors, warnings } = ruleReview(cleanPaper.replace('[3]', '[2]'));
  assert.equal(errors.filter((e) => e.type === 'citation' && e.detail.includes('未在正文')).length, 0, '未引用属 warning');
  assert.ok(warnings.some((w) => w.type === 'citation' && w.detail.includes('未在正文')), '应有未引用提示');
});

test('ruleReview：无参考文献章节时按传入 references 数量校验', () => {
  const noSection = '## 1 引言\n深度学习发展迅速[1][2]。\n\n## 2 结论\n本文方法有效[2]。';
  const r1 = ruleReview(noSection, [{ title: 'A' }, { title: 'B' }]);
  assert.equal(r1.errors.length, 0, '2 条传入文献 + 引 [1][2] 应通过');
  const r2 = ruleReview(noSection, [{ title: 'A' }]);
  assert.ok(r2.errors.some((e) => e.type === 'citation' && e.detail.includes('[2]')), '仅 1 条文献时 [2] 越界应报错');
});

test('ruleReview：空内容直接通过（调用方已保证 content 存在）', () => {
  const { errors, warnings } = ruleReview('');
  assert.equal(errors.length, 0);
  assert.equal(warnings.length, 0);
});

test('parseReviewVerdict：识别需修改结论', () => {
  const report = '## 审校结论\n（整体评价：需修改）\n\n## 引用问题\n- [5] 无法对应';
  assert.equal(parseReviewVerdict(report), 'revise');
});

test('parseReviewVerdict：识别通过结论', () => {
  const report = '## 审校结论\n（整体评价：通过）\n\n## 引用问题\n未发现';
  assert.equal(parseReviewVerdict(report), 'pass');
});

test('parseReviewVerdict：结论为通过时不被后续章节的「需修改」字样污染（窗口溢出回归）', () => {
  // 旧版 120 字符窗口会溢出到引用问题清单，其中「需修改为 [3]」导致误判 revise、多烧一次付费修订
  const report = [
    '## 审校结论',
    '（整体评价：通过）论文整体质量合格，无需返修。',
    '',
    '## 引用问题',
    '- 正文 [5] 引用越界，需修改为 [3]',
    '- [CITE:2] 占位符残留，需修改为真实引用'
  ].join('\n');
  assert.equal(parseReviewVerdict(report), 'pass');
});

test('parseReviewVerdict：无报告或格式异常时宽容判通过（防误触发付费修订）', () => {
  assert.equal(parseReviewVerdict(''), 'pass');
  assert.equal(parseReviewVerdict(null), 'pass');
  assert.equal(parseReviewVerdict('模型自由发挥没有按格式输出'), 'pass');
});

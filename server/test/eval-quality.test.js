// AI 输出质量评测集测试（P1-9）
// 在内置模板引擎（确定性回退）下运行评测集，验证结构质量检查器与全部语料通过。
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkContent, runEval, EVAL_CORPUS, REAL_AI_CHECKS } from '../src/eval/evaluate.js';
import { runAI } from '../src/ai-service.js';

test('评测集语料非空且覆盖核心工具', () => {
  assert.ok(EVAL_CORPUS.length >= 5);
  const tools = new Set(EVAL_CORPUS.map((c) => c.tool));
  for (const t of ['literature_review', 'task_book', 'journal', 'defense', 'proposal', 'polish']) {
    assert.ok(tools.has(t), `评测集缺少工具 ${t}`);
  }
});

test('结构检查器能识别占位符残留与乱码', () => {
  assert.equal(checkContent('[CITE:3] 研究结论', {}).pass, false);
  assert.equal(checkContent('存在乱码\uFFFD字符', {}).pass, false);
  assert.equal(checkContent('正常的一段学术文本', { minLength: 5 }).pass, true);
});

test('评测集内置模式全部通过（无占位符残留/乱码/缺章）', async () => {
  const results = await runEval();
  const failed = results.filter((r) => !r.pass);
  assert.deepEqual(failed.map((r) => `${r.id}: ${r.issues.join('; ')}`), []);
});

test('事实性检查已列为真实 AI 专属（引用真实性/编造数据/一致性）', () => {
  assert.ok(REAL_AI_CHECKS.length >= 3);
  assert.ok(REAL_AI_CHECKS.some((c) => c.includes('citations_exist')));
  assert.ok(REAL_AI_CHECKS.some((c) => c.includes('no_fabricated_data')));
});

test('内置引擎确定性：同一输入多次生成结果一致（质量波动可控）', async () => {
  const c = EVAL_CORPUS.find((x) => x.id === 'task_book_zh');
  const a = await runAI(c.tool, c.params);
  const b = await runAI(c.tool, c.params);
  assert.ok(a.content.length > 0);
  assert.equal(a.content, b.content);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessResearchDelivery,
  classifyReferenceSearch,
  shouldCacheReferenceSearch,
} from '../src/services/research-quality.js';

test('文献检索：全部来源失败与真正零结果严格区分', () => {
  assert.equal(classifyReferenceSearch({ results: [], sources_used: [], errors: ['timeout'] }), 'unavailable');
  assert.equal(classifyReferenceSearch({ results: [], sources_used: ['OpenAlex'], errors: [] }), 'empty');
  assert.equal(classifyReferenceSearch({ results: [{ title: 'x' }], sources_used: ['OpenAlex'], errors: ['arXiv timeout'] }), 'partial');
});

test('文献检索：故障与部分结果不进入长缓存', () => {
  assert.equal(shouldCacheReferenceSearch('unavailable'), false);
  assert.equal(shouldCacheReferenceSearch('partial'), false);
  assert.equal(shouldCacheReferenceSearch('empty'), true);
  assert.equal(shouldCacheReferenceSearch('ok'), true);
});

test('付费深度调研：真实文献和研究框架必须同时达到最低标准', () => {
  const refs = Array.from({ length: 3 }, (_, i) => ({ title: `论文${i}`, doi: `10.1/${i}` }));
  assert.equal(assessResearchDelivery({
    references: refs,
    framework: { paperCount: 3, methods: ['方法'], innovations: ['创新'], conclusions: [] },
  }).ok, true);
  assert.equal(assessResearchDelivery({
    references: refs,
    framework: { paperCount: 3, methods: [], innovations: [], conclusions: [] },
  }).ok, false);
  assert.equal(assessResearchDelivery({
    references: [{ title: '不可溯源记录' }],
    framework: { paperCount: 1, methods: ['方法'], innovations: ['创新'] },
  }).ok, false);
});

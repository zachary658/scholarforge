// graph-core 状态机语义测试
import { test } from 'node:test';
import assert from 'node:assert';
import { createStateGraph } from '../src/services/graph-core.js';

test('顺序边 + 状态深合并 + 单节点重试', async () => {
  let calls = 0;
  const g = createStateGraph({ n: 0 });
  g.addNode('a', async (s) => ({ n: s.n + 1, log: 'a' }));
  g.addNode('b', async (s) => ({ n: s.n + 10, log: s.log + ',b' }));
  g.addNode('flaky', async (s) => {
    calls++;
    if (calls === 1) throw new Error('临时失败');
    return { log: s.log + ',flaky-ok' };
  }, { retry: 2 });
  g.setEntryPoint('a');
  g.addEdge('a', 'b');
  g.addEdge('b', 'flaky');
  g.setFinishPoint('flaky');
  const out = await g.compile().invoke({});
  assert.equal(out.n, 11);
  assert.equal(out.log, 'a,b,flaky-ok');
  assert.equal(calls, 2, '单节点重试应重跑一次');
  assert.deepEqual(out._trace, ['a', 'b', 'flaky']);
});

test('条件边按状态路由', async () => {
  const g = createStateGraph({ x: 2 });
  g.addNode('check', async (s) => ({ result: s.x > 1 ? 'big' : 'small' }));
  g.addNode('big', async (s) => ({ branch: 'BIG' }));
  g.addNode('small', async (s) => ({ branch: 'SMALL' }));
  g.setEntryPoint('check');
  g.addConditionalEdges('check', async (s) => s.result);
  const out = await g.compile().invoke({});
  assert.equal(out.branch, 'BIG');
  assert.deepEqual(out._trace, ['check', 'big']);
});

test('节点超过重试上限仍失败则抛错', async () => {
  const g = createStateGraph({});
  g.addNode('bad', async () => { throw new Error('永远失败'); }, { retry: 1 });
  g.setEntryPoint('bad');
  g.setFinishPoint('bad');
  await assert.rejects(() => g.compile().invoke({}), /永远失败/);
});

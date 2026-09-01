// 前端导航配置单元测试（P1-5 / P1-6）
// 针对 navigation.js 的纯数据配置做结构化断言，覆盖：
//   1) 重构为 6 个一级入口
//   2) 每个一级入口的条目与路由正确
//   3) 客户侧订单入口已合并（仅「我的订单」，移除「毕业作品订单」）
//   4) 所有导航路由唯一
//   5) 每个条目的 icon/label/route 字段合法
import test from 'node:test';
import assert from 'node:assert/strict';
import { navGroups } from '../src/lib/navigation.js';

test('导航重构为 6 个一级入口', () => {
  assert.equal(navGroups.length, 6);
  assert.deepEqual(
    navGroups.map((g) => g.label),
    ['工作台', '论文工作区', 'AI 写作', '文本优化', '1对1指导', '资源与账户'],
  );
});

test('每个一级入口的条目与路由正确', () => {
  const routes = (label) => navGroups.find((g) => g.label === label).items.map((i) => [i.to, i.label]);

  assert.deepEqual(routes('工作台'), [['/app', '概览']]);
  assert.deepEqual(routes('论文工作区'), [['/app/projects', '论文工作区']]);
  assert.deepEqual(routes('AI 写作'), [
    ['/app/writing', '论文写作'],
    ['/app/proposal', '开题报告'],
    ['/app/literature-review', '文献综述'],
    ['/app/task-book', '任务书'],
    ['/app/defense', '答辩PPT+演讲稿'],
    ['/app/journal', '期刊论文'],
  ]);
  assert.deepEqual(routes('文本优化'), [
    ['/app/rewrite', '重复表达优化'],
    ['/app/ai-reduce', '表达自然度优化'],
    ['/app/polish', '润色翻译'],
  ]);
  assert.deepEqual(routes('1对1指导'), [
    ['/app/courses', '论文1对1指导'],
    ['/app/graduation', '毕业作品指导'],
    ['/app/patent', '专利申请'],
    ['/app/publication', '期刊论文发表'],
  ]);
  assert.deepEqual(routes('资源与账户'), [
    ['/app/references', '文献管理'],
    ['/app/charts', '数据图表'],
    ['/app/templates', '格式模板'],
    ['/app/tasks', '我的任务'],
    ['/app/docs', '我的文档'],
    ['/app/orders', '我的订单'],
  ]);
});

test('客户侧订单入口已合并：仅保留「我的订单」，移除「毕业作品订单」', () => {
  const all = navGroups.flatMap((g) => g.items);
  assert.equal(all.filter((i) => i.to === '/app/orders').length, 1);
  assert.equal(all.filter((i) => i.to === '/app/graduation-orders').length, 0);
});

test('所有导航路由唯一（无重复入口）', () => {
  const all = navGroups.flatMap((g) => g.items);
  const tos = all.map((i) => i.to);
  assert.equal(new Set(tos).size, tos.length);
});

test('每个条目均含合法 icon 键、非空 label、/app 前缀路由', () => {
  for (const g of navGroups) {
    for (const item of g.items) {
      assert.equal(typeof item.icon, 'string', `${item.label} 的 icon 应为字符串键`);
      assert.ok(item.icon.length > 0, `${item.label} 的 icon 不能为空`);
      assert.ok(item.label, 'label 不能为空');
      assert.ok(item.to.startsWith('/app'), `${item.label} 的路由应以 /app 开头`);
    }
  }
});

// 前端导航配置单元测试（P1-5 / P1-6）
// 针对 navigation.js 的纯数据配置做结构化断言，覆盖：
//   1) 顶层只有 6 个一级入口（直接链接 or 可展开分组）
//   2) 直接入口（工作台 / 我的论文）指向正确
//   3) 可展开分组的二级工具正确
//   4) 客户侧订单入口已合并（仅「我的订单」，移除「毕业作品订单」）
//   5) 所有导航路由唯一
//   6) icon 键为合法字符串
import test from 'node:test';
import assert from 'node:assert/strict';
import { navGroups } from '../src/lib/navigation.js';

test('顶层只有 6 个一级入口，且名称符合客户心智', () => {
  assert.equal(navGroups.length, 6);
  assert.deepEqual(
    navGroups.map((g) => g.label),
    ['工作台', '我的论文', 'AI 工具', '专家服务', '文献与资料', '订单与交付'],
  );
});

test('直接入口（工作台 / 我的论文）指向正确', () => {
  const dashboard = navGroups.find((g) => g.key === 'dashboard');
  assert.equal(dashboard.to, '/app');
  assert.equal(dashboard.end, true);

  const papers = navGroups.find((g) => g.key === 'papers');
  assert.equal(papers.to, '/app/projects');
});

test('可展开分组的二级工具正确', () => {
  const itemsOf = (key) => navGroups.find((g) => g.key === key).items.map((i) => [i.to, i.label]);

  assert.deepEqual(itemsOf('ai-tools'), [
    ['/app/writing', '论文写作'],
    ['/app/proposal', '开题报告'],
    ['/app/literature-review', '文献综述'],
    ['/app/task-book', '任务书'],
    ['/app/defense', '答辩PPT+演讲稿'],
    ['/app/journal', '期刊论文'],
    ['/app/rewrite', '重复表达优化'],
    ['/app/ai-reduce', '表达自然度优化'],
    ['/app/polish', '润色翻译'],
  ]);
  assert.deepEqual(itemsOf('expert'), [
    ['/app/courses', '论文1对1指导'],
    ['/app/graduation', '毕业作品指导'],
    ['/app/patent', '专利申请'],
    ['/app/publication', '期刊论文发表'],
  ]);
  assert.deepEqual(itemsOf('library'), [
    ['/app/references', '文献管理'],
    ['/app/charts', '数据图表'],
    ['/app/templates', '格式模板'],
  ]);
  assert.deepEqual(itemsOf('delivery'), [
    ['/app/tasks', '我的任务'],
    ['/app/docs', '我的文档'],
    ['/app/orders', '我的订单'],
  ]);
});

test('客户侧订单入口已合并：仅保留「我的订单」，移除「毕业作品订单」', () => {
  const all = navGroups.flatMap((g) => (g.items ? g.items : [{ to: g.to }]));
  assert.equal(all.filter((i) => i.to === '/app/orders').length, 1);
  assert.equal(all.filter((i) => i.to === '/app/graduation-orders').length, 0);
});

test('所有导航路由唯一（无重复入口）', () => {
  const all = navGroups.flatMap((g) => (g.items ? g.items : [{ to: g.to }]));
  const tos = all.map((i) => i.to);
  assert.equal(new Set(tos).size, tos.length);
});

test('每个入口均含合法 icon 键、非空 label、/app 前缀路由', () => {
  for (const g of navGroups) {
    assert.equal(typeof g.icon, 'string', `${g.label} 的 icon 应为字符串键`);
    assert.ok(g.icon.length > 0, `${g.label} 的 icon 不能为空`);
    assert.ok(g.label, 'label 不能为空');
    const links = g.to ? [{ to: g.to }] : g.items;
    for (const item of links) {
      assert.ok(item.to.startsWith('/app'), `${g.label}/${item.to} 应以 /app 开头`);
    }
  }
});

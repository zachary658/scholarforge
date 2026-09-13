import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('用户管理接入客服设置与创建入口，避免双角色误配置', () => {
  const source = read('../src/pages/admin/AdminUsers.jsx');
  assert.match(source, /onClick=\{\(\) => toggleSupport\(u\)\}/);
  assert.match(source, /checked=\{createForm.is_support\}/);
  assert.match(source, /is_support: e.target.checked, is_admin: false/);
  assert.match(source, /is_admin: e.target.checked, is_support: false/);
  assert.match(source, /disabled=\{isSelf \|\| !!u.is_admin\}/);
  assert.match(source, /请填写邮箱、密码和姓名/);
});

test('后台有菜单搜索和用途说明，退款不放入只读监督', () => {
  const source = read('../src/pages/admin/AdminLayout.jsx');
  const readOnly = source.split("label: '服务监督（只读）'")[1].split("label: '商品与定价'")[0];
  assert.doesNotMatch(readOnly, /\/admin\/after-sales/);
  assert.match(source, /搜索后台菜单/);
  assert.match(source, /pageHelp\[pathname\]/);
  assert.match(source, /客服工作台（管理员只读）/);
});

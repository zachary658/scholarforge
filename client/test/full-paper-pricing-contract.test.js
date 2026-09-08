import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(new URL('../src/pages/PaperWorkflow.jsx', import.meta.url), 'utf8');
const pay = fs.readFileSync(new URL('../src/components/FeaturePay.jsx', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('../src/pages/admin/AdminSettings.jsx', import.meta.url), 'utf8');

test('完整论文结算携带项目绑定参数并展示学历套餐信息', () => {
  assert.match(workflow, /params:\s*err\.data\.params/);
  assert.match(workflow, /project_id:\s*Number\(projectId\)/);
  assert.match(pay, /params:\s*needOrder\.params/);
  assert.match(pay, /文献、大纲、逐章生成、审校与导出一次付费/);
});

test('后台可配置学历价格且500%利润保护不能调低', () => {
  assert.match(admin, /full_paper_price_undergraduate/);
  assert.match(admin, /full_paper_price_master/);
  assert.match(admin, /full_paper_price_doctorate/);
  assert.match(admin, /min="5"/);
  assert.match(admin, /成本利润率不低于 500%/);
});

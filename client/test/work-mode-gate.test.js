import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('普通用户工作区挂载不可跳过的使用方式门禁', () => {
  const layout = read('../src/components/Layout.jsx');
  const gate = read('../src/components/WorkModeGate.jsx');
  const modal = read('../src/components/Modal.jsx');

  assert.match(layout, /<WorkModeGate\s*\/>/);
  assert.match(gate, /dismissible=\{false\}/);
  assert.match(gate, /mode === 'full' \? '\/app\/paper-workflow' : '\/app'/);
  assert.match(modal, /dismissible && onClose/);
});

test('登录、注册和退出都会重置本次登录的使用方式选择', () => {
  const auth = read('../src/lib/auth.jsx');
  assert.match(auth, /const WORK_MODE_KEY = 'sf_work_mode_choice'/);
  assert.ok((auth.match(/clearSavedWorkMode\(\)/g) || []).length >= 4);
  assert.match(auth, /sessionStorage\.setItem\(WORK_MODE_KEY/);
});

test('完整论文页面不再保留可关闭的旧目的选择弹窗', () => {
  const workflow = read('../src/pages/PaperWorkflow.jsx');
  assert.doesNotMatch(workflow, /PurposeModal|showPurpose|sf_purpose_choice/);
  assert.match(workflow, /useState\(!projectId\)/);
});

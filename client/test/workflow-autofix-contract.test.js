import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');

test('全文一致性检查提供查看错误、一键纠错和通过后下一步入口', () => {
  const page = read('src/pages/PaperWorkflow.jsx');
  const api = read('src/lib/api.js');
  assert.match(page, /查看错误/);
  assert.match(page, /一键纠错/);
  assert.match(page, /定位：/);
  assert.match(page, /api\.autoFixFinalCheck\(projectId\)/);
  assert.match(page, /下一步：生成最终文档/);
  assert.match(page, /真实文献.*其中外文/);
  assert.match(page, /正在补全文献并检查/);
  assert.match(api, /final-check\/auto-fix/);
});

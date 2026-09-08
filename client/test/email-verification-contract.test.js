import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('登录工作区统一展示邮箱验证入口并接入发送、校验接口', () => {
  const layout = read('src/components/Layout.jsx');
  const banner = read('src/components/EmailVerificationBanner.jsx');
  const api = read('src/lib/api.js');
  assert.match(layout, /<EmailVerificationBanner\s*\/>/);
  assert.match(banner, /user\.email_verified/);
  assert.match(banner, /api\.verifyEmail\(code\)/);
  assert.match(banner, /api\.sendEmailVerification\(\)/);
  assert.match(api, /\/auth\/email-verification\/verify/);
  assert.match(api, /\/auth\/email-verification\/send/);
});

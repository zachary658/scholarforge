import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

test('支付状态轮询禁止请求重叠并保证成功回调幂等', () => {
  const code = source('../src/components/PayModal.jsx');
  assert.match(code, /if \(pollInFlightRef\.current \|\| completedRef\.current\) return/);
  assert.match(code, /if \(completedRef\.current\) return/);
  assert.match(code, /if \(mockInFlightRef\.current \|\| completedRef\.current\) return/);
});

test('章节生成轮询禁止并发请求', () => {
  const code = source('../src/pages/Projects.jsx');
  assert.match(code, /if \(pollInFlightRef\.current\) return/);
  assert.match(code, /finally \{ pollInFlightRef\.current = false; \}/);
});

test('任务重试使用可清理的递归 timeout，不使用异步 interval', () => {
  const code = source('../src/pages/MyTasks.jsx');
  assert.doesNotMatch(code, /setInterval\(async/);
  assert.match(code, /useEffect\(\(\) => stopRetryPolling, \[stopRetryPolling\]\)/);
  assert.match(code, /retryPollRef\.current = setTimeout\(poll, 2000\)/);
});

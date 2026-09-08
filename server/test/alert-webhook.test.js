import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

test('错误 webhook 脱敏发送并对同类告警去重', async (t) => {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { received.push(JSON.parse(body)); res.writeHead(204); res.end(); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${server.address().port}/alert`;
  process.env.ALERT_WEBHOOK_COOLDOWN_MS = '60000';
  const { deliverErrorAlert } = await import(`../src/logger.js?alert-test=${Date.now()}`);
  assert.equal(await deliverErrorAlert('payment', 'failed for owner@example.com', { api_key: 'secret-value' }), true);
  assert.equal(await deliverErrorAlert('payment', 'failed for owner@example.com', { api_key: 'secret-value' }), false);
  assert.equal(received.length, 1);
  assert.doesNotMatch(JSON.stringify(received[0]), /owner@example\.com|secret-value/);
  assert.match(JSON.stringify(received[0]), /redacted|\*\*\*/);
});

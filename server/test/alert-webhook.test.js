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

test('错误 webhook 支持热更新地址并收敛非 2xx 响应', async (t) => {
  let delivered = 0;
  const good = http.createServer((_req, res) => { delivered += 1; res.writeHead(204); res.end(); });
  const bad = http.createServer((_req, res) => { res.writeHead(503); res.end(); });
  await Promise.all([
    new Promise((resolve) => good.listen(0, '127.0.0.1', resolve)),
    new Promise((resolve) => bad.listen(0, '127.0.0.1', resolve)),
  ]);
  t.after(() => { good.close(); bad.close(); });
  process.env.ALERT_WEBHOOK_URL = '';
  const { configureErrorAlert, deliverErrorAlert } = await import(`../src/logger.js?alert-hot-test=${Date.now()}`);
  configureErrorAlert(`http://127.0.0.1:${bad.address().port}/alert`);
  assert.equal(await deliverErrorAlert('backup', 'unique failure 100', {}), false);
  configureErrorAlert(`http://127.0.0.1:${good.address().port}/alert`);
  assert.equal(await deliverErrorAlert('backup', 'different failure 200', {}), true);
  assert.equal(delivered, 1);
  configureErrorAlert('');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-metrics-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.NODE_ENV = 'test';
const db = (await import('../src/db.js')).default;
const { recordOperationalMetric, getOperationalMetrics } = await import('../src/services/operational-metrics.js');

test('运行指标按小时和维度聚合计数与耗时', () => {
  recordOperationalMetric('reference_search', 'ok', 120);
  recordOperationalMetric('reference_search', 'ok', 80);
  recordOperationalMetric('reference_search', 'partial', 50);
  const data = getOperationalMetrics(24);
  const ok = data.rows.find((row) => row.metric === 'reference_search' && row.dimension === 'ok');
  assert.equal(ok.count, 2);
  assert.equal(ok.total_value, 200);
});

test.after(() => { db.close(); fs.rmSync(tmpDir, { recursive: true, force: true }); });

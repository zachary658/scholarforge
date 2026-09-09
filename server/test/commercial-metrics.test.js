import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-commercial-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.NODE_ENV = 'test';
const db = (await import('../src/db.js')).default;
const { getCommercialOverview } = await import('../src/services/commercial-metrics.js');

test('经营看板汇总漏斗、收入、佣金、人工成本与售后积压', () => {
  const userId = Number(db.prepare("INSERT INTO users (email,password_hash,name,email_verified_at) VALUES ('commercial@example.com','x','经营测试',strftime('%s','now'))").run().lastInsertRowid);
  const projectId = Number(db.prepare("INSERT INTO projects (user_id,title) VALUES (?, '研究项目')").run(userId).lastInsertRowid);
  const orderId = Number(db.prepare("INSERT INTO orders (order_no,user_id,type,target,status,amount,paid_at) VALUES ('COMM-1',?,'feature','writing_fulltext','paid',100,strftime('%s','now'))").run(userId).lastInsertRowid);
  const partnerId = Number(db.prepare("INSERT INTO promotion_partners (name,commission_bps) VALUES ('渠道',1000)").run().lastInsertRowid);
  const codeId = Number(db.prepare("INSERT INTO promotion_codes (code,partner_id) VALUES ('COMM10',?)").run(partnerId).lastInsertRowid);
  db.prepare("INSERT INTO service_projects (user_id,service_type,source_type,source_id,order_id,promotion_code_id,internal_cost_cents) VALUES (?,'thesis_coaching','order',?,?,?,2000)").run(userId, orderId, orderId, codeId);
  db.prepare("INSERT INTO after_sales_requests (order_id,user_id,request_type,reason,requested_amount_cents) VALUES (?,?,'technical_failure','测试故障',10000)").run(orderId, userId);
  const result = getCommercialOverview(30);
  assert.equal(result.totals.revenue_cents, 10000);
  assert.equal(result.totals.human_cost_cents, 2000);
  assert.equal(result.totals.commission_cents, 1000);
  assert.equal(result.totals.contribution_cents, 7000);
  assert.equal(result.totals.pending_after_sales, 1);
  assert.ok(result.funnel.find((item) => item.key === 'paid').count >= 1);
  assert.equal(projectId > 0, true);
});

test.after(() => { db.close(); fs.rmSync(tmpDir, { recursive:true, force:true }); });

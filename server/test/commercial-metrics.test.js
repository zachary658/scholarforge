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

test('学位分组使用订单快照并独立聚合收入和多次调用成本', () => {
  const userId = Number(db.prepare("INSERT INTO users(email,password_hash,name) VALUES('tiers@example.com','x','tiers')").run().lastInsertRowid);
  const projectId = Number(db.prepare("INSERT INTO projects(user_id,title,degree) VALUES(?,'changed degree','博士')").run(userId).lastInsertRowid);
  const insert = db.prepare("INSERT INTO orders(order_no,user_id,target,status,amount,paid_at,project_id,metadata,params_json) VALUES(?,?,'writing_fulltext',?,?,strftime('%s','now'),?,?,?)");
  const ug = Number(insert.run('TIER-UG', userId, 'paid', 139, projectId, '{"pricing":{"tierKey":"undergraduate"}}', '{}').lastInsertRowid);
  const master = Number(insert.run('TIER-M', userId, 'completed', 449, projectId, '{}', '{"degree_tier":"master"}').lastInsertRowid);
  insert.run('TIER-D', userId, 'paid', 1399, projectId, '{}', '{}');
  insert.run('TIER-UNPAID', userId, 'pending', 999, projectId, '{"pricing":{"tierKey":"undergraduate"}}', '{}');
  const log = db.prepare("INSERT INTO usage_logs(user_id,tool_type,action,order_id,tokens,input_chars,output_chars,status) VALUES(?,'writing','fulltext',?,?,?,?,?)");
  log.run(userId, ug, 1000000, 3, 1, 'success');
  log.run(userId, ug, 1000000, 3, 1, 'failed'); // Failed calls with recorded tokens still cost money.
  log.run(userId, master, 0, 0, 0, 'success');
  log.run(userId, null, 9000000, 1, 1, 'success'); // Unattributable usage is not assigned by user.
  const rows = getCommercialOverview().byDegreeTier;
  const undergraduate = rows.find((row) => row.degree === 'undergraduate');
  assert.equal(undergraduate.paidOrderCount, 1);
  assert.equal(undergraduate.revenueCents, 13900);
  assert.equal(undergraduate.averageOrderRevenueCents, 13900);
  assert.equal(undergraduate.estimatedAiCostCents, 950);
  assert.equal(undergraduate.averageAiCostCents, 950);
  assert.equal(undergraduate.loggedUsageCount, 2);
  assert.equal(undergraduate.estimatedGrossMargin, Number(((13900 - 950) / 13900).toFixed(4)));
  assert.equal(undergraduate.costCoverage, 1);
  assert.equal(rows.find((row) => row.degree === 'master').averageAiCostCents, null);
  assert.equal(rows.find((row) => row.degree === 'doctorate').estimatedGrossMargin, null);
  // A second paid order without usage must not masquerade as zero cost / full margin.
  insert.run('TIER-UG-MISSING', userId, 'paid', 139, projectId, '{"pricing":{"tierKey":"undergraduate"}}', '{}');
  const partial = getCommercialOverview().byDegreeTier.find((row) => row.degree === 'undergraduate');
  assert.equal(partial.costCoverage, 0.5);
  assert.equal(partial.estimatedGrossMargin, null);
  assert.equal(partial.averageAiCostCents, 950);
});

test('学位统计忽略窗口外订单，空档位不返回虚假零成本或毛利', () => {
  const rows = getCommercialOverview(1).byDegreeTier;
  const before = rows.find((row) => row.degree === 'master').paidOrderCount;
  db.prepare("UPDATE orders SET paid_at=1 WHERE order_no='TIER-M'").run();
  const master = getCommercialOverview(1).byDegreeTier.find((row) => row.degree === 'master');
  assert.equal(master.paidOrderCount, before - 1);
  assert.equal(master.averageOrderRevenueCents, null);
  assert.equal(master.averageAiCostCents, null);
  assert.equal(master.estimatedGrossMargin, null);
});

test.after(() => { db.close(); fs.rmSync(tmpDir, { recursive:true, force:true }); });

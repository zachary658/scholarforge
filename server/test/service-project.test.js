import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-service-project-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.NODE_ENV = 'test';
const db = (await import('../src/db.js')).default;
const {
  ensureServiceProject, getServiceProject, normalizePromotionCode, resolvePromotion,
  updateServiceProject, addSubmission, deletePromotionCode, deletePromotionPartner,
  promotionPartnerStats, setPromotionPartnerActive,
} = await import('../src/services/service-project-service.js');
const { createOrder, markOrderPaid } = await import('../src/services/payment.js');

const userId = Number(db.prepare("INSERT INTO users (email,password_hash,name) VALUES ('service@example.com','x','测试用户')").run().lastInsertRowid);
const partnerId = Number(db.prepare("INSERT INTO promotion_partners (name) VALUES ('校园渠道')").run().lastInsertRowid);
db.prepare("INSERT INTO promotion_codes (code,partner_id) VALUES ('CAMPUS01',?)").run(partnerId);

test('推广码规范化、校验与不可变归因快照', () => {
  assert.equal(normalizePromotionCode(' campus 01 '), 'CAMPUS01');
  assert.equal(resolvePromotion('campus01').partner_name, '校园渠道');
  assert.throws(() => resolvePromotion('missing'), /不存在|停用/);
  const project = ensureServiceProject({ userId, serviceType:'graduation_project', sourceType:'graduation_project_order', sourceId:9001, requestSnapshot:{title:'原始需求'}, promotionCode:'campus01', status:'evaluating' });
  assert.equal(project.promotion_code_snapshot, 'CAMPUS01');
  assert.equal(project.promotion_partner_snapshot, '校园渠道');
  assert.equal(ensureServiceProject({ userId, serviceType:'graduation_project', sourceType:'graduation_project_order', sourceId:9001, promotionCode:'' }).id, project.id);
});

test('推广方可启停，删除会保护已有归因且允许清理无引用记录', () => {
  setPromotionPartnerActive(partnerId, false);
  assert.throws(() => resolvePromotion('CAMPUS01'), /停用/);
  setPromotionPartnerActive(partnerId, true);
  assert.equal(resolvePromotion('CAMPUS01').partner_id, partnerId);
  assert.throws(() => deletePromotionCode(db.prepare("SELECT id FROM promotion_codes WHERE code='CAMPUS01'").get().id), /关联/);
  assert.throws(() => deletePromotionPartner(partnerId), /推广码/);

  const emptyPartner = Number(db.prepare("INSERT INTO promotion_partners (name) VALUES ('待清理渠道')").run().lastInsertRowid);
  const emptyCode = Number(db.prepare("INSERT INTO promotion_codes (code,partner_id) VALUES ('UNUSED01',?)").run(emptyPartner).lastInsertRowid);
  assert.ok(promotionPartnerStats().some((item) => item.id === emptyPartner && item.code_count === 1));
  assert.equal(deletePromotionCode(emptyCode), true);
  assert.equal(deletePromotionPartner(emptyPartner), true);
  assert.equal(db.prepare('SELECT id FROM promotion_partners WHERE id=?').get(emptyPartner), undefined);
});

test('状态机、乐观锁、幂等更新和内部备注隔离', () => {
  let project = ensureServiceProject({ userId, serviceType:'thesis_coaching', sourceType:'order', sourceId:9002, status:'awaiting_payment' });
  project = updateServiceProject(project.id, { expectedVersion:project.version, status:'paid', note:'支付完成', internalNote:'内部成本信息', idempotencyKey:'pay-9002' });
  assert.equal(project.status, 'paid');
  const same = updateServiceProject(project.id, { expectedVersion:1, status:'paid', idempotencyKey:'pay-9002' });
  assert.equal(same.version, project.version);
  assert.throws(() => updateServiceProject(project.id, { expectedVersion:1, status:'in_progress' }), /刷新后重试/);
  project = updateServiceProject(project.id, { expectedVersion:project.version, status:'in_progress' });
  assert.throws(() => updateServiceProject(project.id, { expectedVersion:project.version, status:'completed' }), /不能从/);
  const publicView = getServiceProject(project.id, userId);
  assert.equal(publicView.internal_note, undefined);
  assert.ok(publicView.updates.length >= 3);
});

test('待验收项目支持修改申请和确认验收', () => {
  let project = ensureServiceProject({ userId, serviceType:'graduation_project', sourceType:'graduation_project_order', sourceId:9003, status:'paid' });
  project = updateServiceProject(project.id, { expectedVersion:project.version, status:'in_progress' });
  project = updateServiceProject(project.id, { expectedVersion:project.version, status:'pending_acceptance' });
  addSubmission(getServiceProject(project.id, userId), userId, 'revision_request', '请调整第二部分', 'rev-1');
  project = db.prepare('SELECT * FROM service_projects WHERE id=?').get(project.id);
  assert.equal(project.status, 'revision');
  project = updateServiceProject(project.id, { expectedVersion:project.version, status:'pending_acceptance' });
  addSubmission(getServiceProject(project.id, userId), userId, 'acceptance', '', 'accept-1');
  assert.equal(db.prepare('SELECT status FROM service_projects WHERE id=?').get(project.id).status, 'completed');
});

test('课程支付只创建一个服务项目并锁定推广归因', async () => {
  const course = db.prepare('SELECT id FROM courses ORDER BY id LIMIT 1').get();
  const created = createOrder({
    userId, type:'course', target:String(course.id), channel:'mock',
    courseRequirements:{ major:'计算机科学', paper_type:'毕业论文', promotion_code:' campus01 ' },
  });
  let project = db.prepare("SELECT * FROM service_projects WHERE source_type='order' AND source_id=?").get(created.order.id);
  assert.equal(project.status, 'awaiting_payment');
  assert.equal(project.promotion_code_snapshot, 'CAMPUS01');
  await markOrderPaid({ orderNo:created.order.order_no, transactionId:'mock-service-1', channel:'mock' });
  project = db.prepare('SELECT * FROM service_projects WHERE id=?').get(project.id);
  assert.equal(project.status, 'paid');
  assert.ok(project.promotion_locked_at);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM service_projects WHERE source_type=\'order\' AND source_id=?').get(created.order.id).c, 1);
});

test('进度与预计完成时间拒绝非数字脏数据', () => {
  const project = ensureServiceProject({ userId, serviceType:'graduation_project', sourceType:'validation', sourceId:9004 });
  assert.throws(() => updateServiceProject(project.id, {
    expectedVersion: project.version,
    progress: 'not-a-number',
  }), /进度必须/);
  assert.throws(() => updateServiceProject(project.id, {
    expectedVersion: project.version,
    etaAt: 'tomorrow',
  }), /预计完成时间格式无效/);
});

test('服务边界、工时和内部成本可归集且有范围校验', () => {
  let project = ensureServiceProject({ userId, serviceType:'thesis_coaching', sourceType:'costing', sourceId:9005 });
  project = updateServiceProject(project.id, {
    expectedVersion: project.version,
    scopeSummary: '包含研究方法指导与两轮反馈，不代替用户提交',
    estimatedHours: 12.5,
    actualHours: 3,
    internalCostCents: 45600,
  });
  assert.equal(project.scope_summary, '包含研究方法指导与两轮反馈，不代替用户提交');
  assert.equal(project.estimated_hours, 12.5);
  assert.equal(project.actual_hours, 3);
  assert.equal(project.internal_cost_cents, 45600);
  assert.throws(() => updateServiceProject(project.id, { expectedVersion:project.version, estimatedHours:-1 }), /工时必须/);
  assert.throws(() => updateServiceProject(project.id, { expectedVersion:project.version, internalCostCents:1.5 }), /内部成本必须/);
});

test('推广方统计按佣金比例计算估算佣金', () => {
  db.prepare('UPDATE promotion_partners SET commission_bps=1250, settlement_hold_days=14 WHERE id=?').run(partnerId);
  const row = promotionPartnerStats().find((item) => item.id === partnerId);
  assert.equal(row.commission_bps, 1250);
  assert.equal(row.settlement_hold_days, 14);
  assert.ok(Number(row.commission_cents) >= 0);
});

test.after(() => { db.close(); fs.rmSync(tmpDir, { recursive:true, force:true }); });

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
  updateServiceProject, addSubmission,
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

test.after(() => { db.close(); fs.rmSync(tmpDir, { recursive:true, force:true }); });

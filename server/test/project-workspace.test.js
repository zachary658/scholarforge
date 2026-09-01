// 论文工作区（P1-4）单元测试
// 覆盖 task-store 新增字段：
//   1) createProject 默认字段（current_stage=create / completion_percent=0 / degree&deadline 为空）
//   2) createProject 完整字段入库并可读回（degree/deadline/current_stage/completion_percent）
//   3) updateProject 更新这四个字段
//   4) updateProject deadline 字符串强转数字、空值清空为 null
//   5) updateProject completion_percent 非法值归零
//   6) updateProject 忽略未授权字段（白名单）
//   7) listProjects 返回新字段
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-proj-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.NODE_ENV = 'test';

const db = (await import('../src/db.js')).default;
const { createProject, updateProject, getProject, listProjects } = await import('../src/services/task-store.js');
const { hashPassword } = await import('../src/auth.js');

const DEADLINE = 1735689600; // 2025-01-01 00:00:00 UTC（Unix 秒）

async function createTestUser(email) {
  const hash = await hashPassword('TestPass123');
  const info = db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)').run(email, hash, '测试用户');
  return info.lastInsertRowid;
}

test('createProject：默认字段 current_stage=create / completion_percent=0 / degree&deadline 为空', async () => {
  const uid = await createTestUser(`proj-default-${Date.now()}@example.com`);
  const p = createProject({ userId: uid, title: '默认字段测试论文' });
  assert.equal(p.title, '默认字段测试论文');
  assert.equal(p.current_stage, 'create');
  assert.equal(p.completion_percent, 0);
  assert.equal(p.degree, null);
  assert.equal(p.deadline, null);
  assert.equal(p.status, 'active');
});

test('createProject：完整字段入库并可读回', async () => {
  const uid = await createTestUser(`proj-full-${Date.now()}@example.com`);
  const p = createProject({
    userId: uid,
    title: '完整字段论文',
    field: '计算机科学',
    degree: '硕士',
    deadline: DEADLINE,
    current_stage: 'outline',
    completion_percent: 50,
  });
  assert.equal(p.field, '计算机科学');
  assert.equal(p.degree, '硕士');
  assert.equal(p.deadline, DEADLINE);
  assert.equal(p.current_stage, 'outline');
  assert.equal(p.completion_percent, 50);
});

test('updateProject：可更新 degree/deadline/current_stage/completion_percent', async () => {
  const uid = await createTestUser(`proj-upd-${Date.now()}@example.com`);
  const p = createProject({ userId: uid, title: '更新测试论文' });
  const updated = updateProject(p.id, uid, {
    degree: '博士',
    deadline: DEADLINE + 86400,
    current_stage: 'writing',
    completion_percent: 75,
  });
  assert.equal(updated.degree, '博士');
  assert.equal(updated.deadline, DEADLINE + 86400);
  assert.equal(updated.current_stage, 'writing');
  assert.equal(updated.completion_percent, 75);
});

test('updateProject：deadline 字符串强转数字、空值清空为 null', async () => {
  const uid = await createTestUser(`proj-deadline-${Date.now()}@example.com`);
  const p = createProject({ userId: uid, title: '截止时间测试论文' });

  const u1 = updateProject(p.id, uid, { deadline: String(DEADLINE) });
  assert.equal(u1.deadline, DEADLINE);
  assert.equal(typeof u1.deadline, 'number');

  const u2 = updateProject(p.id, uid, { deadline: null });
  assert.equal(u2.deadline, null);
});

test('updateProject：completion_percent 非法值抛 400（不静默归零）', async () => {
  const uid = await createTestUser(`proj-pct-${Date.now()}@example.com`);
  const p = createProject({ userId: uid, title: '完成度测试论文', completion_percent: 40 });
  // 负数 / 超上限 / 非数字均应拒绝（400），且不改变原值
  assert.throws(() => updateProject(p.id, uid, { completion_percent: -5 }), (e) => e.statusCode === 400);
  assert.throws(() => updateProject(p.id, uid, { completion_percent: 500 }), (e) => e.statusCode === 400);
  assert.throws(() => updateProject(p.id, uid, { completion_percent: 'abc' }), (e) => e.statusCode === 400);
  assert.equal(getProject(p.id, uid).completion_percent, 40);
});

test('updateProject：current_stage 白名单校验', async () => {
  const uid = await createTestUser(`proj-stage-${Date.now()}@example.com`);
  const p = createProject({ userId: uid, title: '阶段测试论文' });
  assert.equal(updateProject(p.id, uid, { current_stage: 'writing' }).current_stage, 'writing');
  assert.throws(() => updateProject(p.id, uid, { current_stage: 'hacked' }), (e) => e.statusCode === 400);
});

test('updateProject：忽略未授权字段（白名单）', async () => {
  const uid = await createTestUser(`proj-allow-${Date.now()}@example.com`);
  const p = createProject({ userId: uid, title: '白名单测试论文' });
  const u = updateProject(p.id, uid, { title: '改后标题', malicious: 'DROP TABLE projects' });
  assert.equal(u.title, '改后标题');
  // 未授权字段不应写入（列不存在）
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(p.id);
  assert.equal('malicious' in row, false);
});

test('getProject / listProjects：返回新字段', async () => {
  const uid = await createTestUser(`proj-list-${Date.now()}@example.com`);
  createProject({ userId: uid, title: '列表测试A', degree: '本科', deadline: DEADLINE, current_stage: 'literature', completion_percent: 30 });
  createProject({ userId: uid, title: '列表测试B' });

  const list = listProjects(uid);
  assert.equal(list.length, 2);
  const a = list.find((x) => x.title === '列表测试A');
  assert.ok(a, '应能按标题找到项目');
  assert.equal(a.degree, '本科');
  assert.equal(a.deadline, DEADLINE);
  assert.equal(a.current_stage, 'literature');
  assert.equal(a.completion_percent, 30);

  // getProject 单条读取同样带出新字段
  const single = getProject(a.id, uid);
  assert.equal(single.degree, '本科');
  assert.equal(single.deadline, DEADLINE);
  assert.equal(single.current_stage, 'literature');
  assert.equal(single.completion_percent, 30);
});

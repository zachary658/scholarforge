// 论文工作区「系统进度推导」测试（P1-5）
// 验证 computeSystemProgress 依据实际产物/已完成任务自动推导进度，与手工 completion_percent 解耦。
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-progress-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.NODE_ENV = 'test';

const db = (await import('../src/db.js')).default;
const { createProject, getProject, confirmOutline, saveProjectOutline, saveProjectSources, computeSystemProgress } = await import('../src/services/task-store.js');
const { hashPassword } = await import('../src/auth.js');

async function createTestUser(email) {
  const hash = await hashPassword('TestPass123');
  const info = db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)').run(email, hash, '测试用户');
  return info.lastInsertRowid;
}

test('系统进度：新建项目为 5%（create）', async () => {
  const uid = await createTestUser(`prog-${Date.now()}@example.com`);
  const p = createProject({ userId: uid, title: '系统进度测试论文' });
  const sys = computeSystemProgress(uid, p.id);
  assert.equal(sys.stage, 'create');
  assert.equal(sys.percent, 5);
  assert.equal(getProject(p.id, uid).system_progress, 5);
});

test('系统进度：随里程碑推进（资料→大纲→文献）', async () => {
  const uid = await createTestUser(`prog2-${Date.now()}@example.com`);
  const p = createProject({ userId: uid, title: '里程碑推导测试' });

  // 上传资料 → materials (15)
  db.prepare('INSERT INTO materials (user_id, project_id, name, file_type, text_content, tokens) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uid, p.id, '参考.pdf', 'pdf', '内容', 10);
  assert.equal(computeSystemProgress(uid, p.id).percent, 15);

  // 确认大纲 → outline (25)
  confirmOutline(p.id, uid);
  assert.equal(computeSystemProgress(uid, p.id).percent, 25);

  // 蒸馏出文献 → literature (40)
  saveProjectSources(p.id, uid, { framework: null, references: [{ title: '某文献' }], benchmarks: [], tables: [], sources_used: [] });
  assert.equal(computeSystemProgress(uid, p.id).percent, 40);
  assert.equal(computeSystemProgress(uid, p.id).stage, 'literature');
});

test('系统进度：getProject/listProjects 返回 system_progress 字段', async () => {
  const uid = await createTestUser(`prog3-${Date.now()}@example.com`);
  const p = createProject({ userId: uid, title: '字段返回测试' });
  const got = getProject(p.id, uid);
  assert.equal(typeof got.system_progress, 'number');
  assert.equal(typeof got.system_stage, 'string');
  const { listProjects } = await import('../src/services/task-store.js');
  const list = listProjects(uid);
  assert.ok(list.every((x) => typeof x.system_progress === 'number'));
});

test('保存大纲或文献产物后同步推进持久化阶段', async () => {
  const uid = await createTestUser(`prog4-${Date.now()}@example.com`);
  const p = createProject({ userId: uid, title: '阶段同步测试' });

  saveProjectOutline(p.id, uid, [{ title: '第一章 绪论', children: [] }]);
  assert.equal(getProject(p.id, uid).current_stage, 'outline');

  saveProjectSources(p.id, uid, { references: [{ title: '真实文献' }] });
  assert.equal(getProject(p.id, uid).current_stage, 'literature');
});

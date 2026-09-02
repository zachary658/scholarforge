// 后台重试机制 + 阶段自动前推 测试（P1-2 / P1-5）
// 覆盖 updateTaskResult（原地更新而非新建任务）与 syncProjectStage（只进不退）。
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-retryasync-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.NODE_ENV = 'test';

const db = (await import('../src/db.js')).default;
const { createProject, updateTaskResult, syncProjectStage, confirmOutline } = await import('../src/services/task-store.js');
const { hashPassword } = await import('../src/auth.js');

async function createUser(email) {
  const hash = await hashPassword('TestPass123');
  const info = db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)').run(email, hash, '测试用户');
  return info.lastInsertRowid;
}

test('updateTaskResult 原地更新既有任务，不新建记录', async () => {
  const uid = await createUser(`ra1-${Date.now()}@example.com`);
  const taskId = db.prepare(
    "INSERT INTO ai_tasks (user_id, tool_type, action, input_text, output_text, status) VALUES (?, 'polish', 'polish', '输入', '', 'failed')"
  ).run(uid).lastInsertRowid;

  const changed = updateTaskResult(taskId, uid, { status: 'success', outputText: '优化后的输出', modelName: 'builtin', tokens: 0, progress: 100 });
  assert.equal(changed, true);

  const t = db.prepare('SELECT status, output_text, progress FROM ai_tasks WHERE id = ?').get(taskId);
  assert.equal(t.status, 'success');
  assert.equal(t.output_text, '优化后的输出');
  assert.equal(t.progress, 100);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM ai_tasks WHERE user_id = ?').get(uid).c, 1);
});

test('updateTaskResult 越权不生效（他人任务不可改）', async () => {
  const uid = await createUser(`ra2-${Date.now()}@example.com`);
  const taskId = db.prepare(
    "INSERT INTO ai_tasks (user_id, tool_type, action, input_text, output_text, status) VALUES (?, 'polish', 'polish', '输入', '', 'failed')"
  ).run(uid).lastInsertRowid;

  const changed = updateTaskResult(taskId, 999999, { status: 'success' });
  assert.equal(changed, false);
  assert.equal(db.prepare('SELECT status FROM ai_tasks WHERE id = ?').get(taskId).status, 'failed');
});

test('syncProjectStage：任务完成后阶段只进不退', async () => {
  const uid = await createUser(`sync-${Date.now()}@example.com`);
  const p = createProject({ userId: uid, title: '阶段前推测试' });
  assert.equal(p.current_stage, 'create');

  // 确认大纲后，系统进度达 outline (25)，current_stage 应前推到 outline
  confirmOutline(p.id, uid);
  assert.equal(syncProjectStage(uid, p.id), 'outline');
  assert.equal(db.prepare('SELECT current_stage FROM projects WHERE id = ?').get(p.id).current_stage, 'outline');

  // 手工把阶段设到更靠后的 writing，再同步不应回退
  db.prepare("UPDATE projects SET current_stage = 'writing' WHERE id = ?").run(p.id);
  assert.equal(syncProjectStage(uid, p.id), null); // 无变化
  assert.equal(db.prepare('SELECT current_stage FROM projects WHERE id = ?').get(p.id).current_stage, 'writing');
});

// 备份/恢复/数据清理/令牌吊销 验证（P1-8）
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-backup-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.NODE_ENV = 'test';

const db = (await import('../src/db.js')).default;
const { backupDatabase } = await import('../src/services/backup.js');
const { cleanupOldDocs, cleanupOldTasks } = await import('../src/services/task-store.js');
const { hashPassword } = await import('../src/auth.js');
const { signRefreshToken, verifyRefreshToken, revokeRefreshToken } = await import('../src/auth.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsDir = join(__dirname, '..', 'uploads', 'docs');

async function createUser(email) {
  const hash = await hashPassword('TestPass123');
  const info = db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)').run(email, hash, '测试用户');
  return { id: info.lastInsertRowid, email, name: '测试用户' };
}

test('备份可恢复：备份文件是完整可读的 SQLite 数据库', async () => {
  const user = await createUser(`backup-${Date.now()}@example.com`);
  const projectId = db.prepare('INSERT INTO projects (user_id, title) VALUES (?, ?)').run(user.id, '备份验证论文').lastInsertRowid;

  const backupPath = path.join(tmpDir, 'snapshot.db');
  await backupDatabase(db, backupPath);
  assert.ok(fs.existsSync(backupPath));

  // 用新连接打开备份，验证数据完整
  const restored = new Database(backupPath, { readonly: true });
  const row = restored.prepare('SELECT title FROM projects WHERE id = ?').get(projectId);
  assert.equal(row.title, '备份验证论文');
  const u = restored.prepare('SELECT email FROM users WHERE id = ?').get(user.id);
  assert.equal(u.email, user.email);
  restored.close();
});

test('清理旧文档：磁盘文件与数据库记录同步删除', () => {
  const uid = db.prepare('SELECT id FROM users ORDER BY id DESC LIMIT 1').get().id;
  const fileName = `${uid}_cleanuptest.docx`;
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(join(docsDir, fileName), 'fake docx content');

  const oldTs = Math.floor(Date.now() / 1000) - 40 * 86400; // 40 天前，超过 30 天保留期
  const info = db.prepare(
    'INSERT INTO generated_docs (user_id, title, feature, file_path, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(uid, '待清理文档', 'proposal', fileName, oldTs);
  const docId = info.lastInsertRowid;

  const deleted = cleanupOldDocs();
  assert.ok(deleted >= 1);
  assert.equal(fs.existsSync(join(docsDir, fileName)), false, '磁盘文件应被删除');
  assert.equal(db.prepare('SELECT id FROM generated_docs WHERE id = ?').get(docId), undefined, '数据库记录应被删除');
});

test('清理旧任务：按保留期删除过期任务记录', () => {
  const uid = db.prepare('SELECT id FROM users ORDER BY id DESC LIMIT 1').get().id;
  const oldTs = Math.floor(Date.now() / 1000) - 40 * 86400;
  const info = db.prepare(
    'INSERT INTO ai_tasks (user_id, tool_type, action, input_text, output_text, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(uid, 'polish', 'polish', '输入', '输出', 'success', oldTs);

  const deleted = cleanupOldTasks();
  assert.ok(deleted >= 1);
  assert.equal(db.prepare('SELECT id FROM ai_tasks WHERE id = ?').get(info.lastInsertRowid), undefined);
});

test('登出吊销 refresh token：吊销后无法再校验通过', async () => {
  const user = await createUser(`revoke-${Date.now()}@example.com`);
  const token = await signRefreshToken(user);
  assert.ok(verifyRefreshToken(token), '签发后应可校验');

  revokeRefreshToken(token);
  assert.equal(verifyRefreshToken(token), null, '吊销后应校验失败');
});

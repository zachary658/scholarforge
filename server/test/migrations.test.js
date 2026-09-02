// 版本化迁移系统测试
// 覆盖：
//   1) 启动后 schema_migrations 记录全部版本
//   2) 迁移幂等：重复执行 runMigrations 不报错、版本不重复
//   3) 各迁移产物真实存在
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-migrate-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.NODE_ENV = 'test';

const db = (await import('../src/db.js')).default;
const { runMigrations } = await import('../src/migrations.js');

const appliedVersions = () => db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((r) => r.version);
const columnsOf = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

const EXPECTED_VERSIONS = ['001_initial', '002_order_events', '003_project_workflow', '004_task_retry', '005_project_resources'];

test('schema_migrations 记录全部版本', () => {
  assert.deepEqual(appliedVersions(), EXPECTED_VERSIONS);
});

test('迁移幂等：重复执行 runMigrations 不报错、版本不重复', () => {
  runMigrations(db);
  runMigrations(db);
  assert.deepEqual(appliedVersions(), EXPECTED_VERSIONS);
});

test('002_order_events：order_events 表已创建', () => {
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'order_events'").get();
  assert.ok(t);
  assert.ok(columnsOf('order_events').includes('domain'));
  assert.ok(columnsOf('order_events').includes('to_status'));
});

test('003_project_workflow：projects 工作流列已存在', () => {
  const cols = columnsOf('projects');
  for (const c of ['current_stage', 'completion_percent', 'degree', 'deadline', 'outline_confirmed_at', 'chapters_json', 'sources_json', 'auto_created']) {
    assert.ok(cols.includes(c), `projects 缺少列 ${c}`);
  }
});

test('004_task_retry：ai_tasks 重试列已存在', () => {
  const cols = columnsOf('ai_tasks');
  for (const c of ['progress', 'stage', 'error_code', 'retry_count']) {
    assert.ok(cols.includes(c), `ai_tasks 缺少列 ${c}`);
  }
});

test('005_project_resources：核心成果表具备项目归属', () => {
  for (const table of ['generated_docs', 'documents', 'orders', 'charts']) {
    assert.ok(columnsOf(table).includes('project_id'), `${table} 缺少列 project_id`);
  }
  assert.ok(columnsOf('"references"').includes('project_id'), 'references 缺少列 project_id');
});

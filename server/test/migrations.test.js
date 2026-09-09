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

const EXPECTED_VERSIONS = ['001_initial', '002_order_events', '003_project_workflow', '004_task_retry', '005_project_resources', '006_evidence_library', '007_service_projects_and_promotion', '008_operational_metrics', '009_email_verification', '010_admin_operation_log', '011_staff_totp', '012_secure_settings', '013_admin_audit_hmac', '014_commercial_foundation', '015_support_quote_ownership', '016_service_change_orders', '017_course_support_quotes'];

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

test('007_service_projects_and_promotion：人工服务履约与推广归因表已创建', () => {
  for (const table of ['promotion_partners', 'promotion_codes', 'service_projects', 'service_project_updates', 'service_project_submissions', 'service_project_attachments', 'notifications']) {
    const found = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
    assert.ok(found, `缺少表 ${table}`);
  }
  for (const column of ['project_no', 'service_type', 'request_snapshot_json', 'promotion_code_snapshot', 'promotion_locked_at', 'version']) {
    assert.ok(columnsOf('service_projects').includes(column), `service_projects 缺少列 ${column}`);
  }
});

test('008_operational_metrics：运行指标表已创建', () => {
  const found = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='operational_metrics'").get();
  assert.ok(found);
  for (const column of ['bucket_hour', 'metric', 'dimension', 'count', 'total_value']) {
    assert.ok(columnsOf('operational_metrics').includes(column));
  }
});

test('009_email_verification：用户验证字段与验证码表已创建', () => {
  assert.ok(columnsOf('users').includes('email_verified_at'));
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='email_verification_codes'").get());
});

test('010/011：操作审计与后台双因素认证结构已创建', () => {
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='admin_operation_logs'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='totp_recovery_codes'").get());
  assert.ok(columnsOf('users').includes('totp_secret_enc'));
  assert.ok(columnsOf('users').includes('totp_enabled_at'));
});

test('012：敏感配置保险箱已创建', () => {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='secure_settings'").get();
  assert.ok(table);
  assert.ok(columnsOf('secure_settings').includes('encrypted_value'));
});

test('013：操作审计具备哈希与密钥版本列', () => {
  assert.ok(columnsOf('admin_operation_logs').includes('hash_version'));
  assert.ok(columnsOf('admin_operation_logs').includes('key_version'));
});

test('014：商业漏斗、售后、渠道佣金与履约成本结构已创建', () => {
  for (const table of ['business_events', 'after_sales_requests']) {
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
  }
  assert.ok(columnsOf('promotion_partners').includes('commission_bps'));
  for (const column of ['estimated_hours', 'actual_hours', 'internal_cost_cents', 'scope_summary']) {
    assert.ok(columnsOf('service_projects').includes(column));
  }
});

test('015：人工服务报价保存学科成本快照与用户确认时间', () => {
  for (const table of ['graduation_project_orders', 'patent_orders', 'publication_orders']) {
    for (const column of ['discipline_category', 'estimated_hours', 'quote_scope', 'quote_exclusions', 'cost_snapshot_json', 'quoted_by', 'quote_sent_at', 'quote_confirmed_at']) {
      assert.ok(columnsOf(table).includes(column), `${table} 缺少列 ${column}`);
    }
  }
  assert.ok(columnsOf('service_projects').includes('discipline_category'));
});

test('016：人工服务需求变更单与补款关联结构已创建', () => {
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='service_change_orders'").get());
  for (const column of ['change_no', 'source_order_id', 'payment_order_id', 'assessment_type', 'amount_cents', 'cost_snapshot_json']) {
    assert.ok(columnsOf('service_change_orders').includes(column));
  }
});

test('017：论文指导正式报价在服务项目中完整留痕', () => {
  for (const column of ['quote_exclusions', 'cost_snapshot_json', 'quoted_by', 'quote_sent_at', 'quote_confirmed_at']) {
    assert.ok(columnsOf('service_projects').includes(column), `service_projects 缺少列 ${column}`);
  }
});

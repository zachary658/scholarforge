import logger from './logger.js';

// ============================================================================
// 版本化数据库迁移系统
// ----------------------------------------------------------------------------
// 目标：解决「addColumnIfMissing + 启动时建表」无法精确感知数据库版本、无法回滚、
//       多实例并发迁移、失败后中间态等问题。
//
// 机制：
//   - schema_migrations 表记录已应用的迁移版本（version 为主键，天然防并发重复应用）。
//   - 每个迁移在独立 SQLite 事务内执行：要么「DDL + 版本记录」一起成功，要么一起回滚，
//     不会留下「表已建但版本未记」的中间态。
//   - 迁移内容幂等（CREATE TABLE IF NOT EXISTS / 守卫式 ADD COLUMN），
//     对「旧库已通过历史 addColumnIfMissing 建好字段」的场景同样安全（no-op 后记录版本）。
//
// 备份与回滚说明：
//   - 升级前备份：cp data/scholarforge.db data/scholarforge.db.bak-$(date +%s)
//     （WAL 模式下建议先 `PRAGMA wal_checkpoint(TRUNCATE)` 再复制，或连同 -wal/-shm 一起备份）。
//   - 回滚：直接恢复备份的 .db 文件即可；若需仅回退某个版本，删除 schema_migrations 中
//     对应 version 行并手动执行反向 DDL（本系统不自动执行 down，避免误删数据）。
//   - 新增迁移：在 MIGRATIONS 末尾追加 { version, name, up(db) }，不要修改已发布版本。
// ============================================================================

const ORDER_EVENTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS order_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    order_no TEXT,
    domain TEXT NOT NULL,
    ref_type TEXT NOT NULL,
    ref_id INTEGER NOT NULL,
    field TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    operator_id INTEGER,
    operator_name TEXT,
    reason TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_order_events_ref ON order_events(ref_type, ref_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id, created_at DESC);
`;

// 论文工作区主流程字段（阶段推进 / 截止时间 / 完成度 / 蒸馏产物）
const PROJECT_WORKFLOW_COLUMNS = [
  ['projects', 'outline_confirmed_at', 'INTEGER'],
  ['projects', 'chapters_json', "TEXT DEFAULT '[]'"],
  ['projects', 'sources_json', "TEXT DEFAULT '{}'"],
  ['projects', 'auto_created', 'INTEGER NOT NULL DEFAULT 0'],
  ['projects', 'degree', 'TEXT'],
  ['projects', 'current_stage', "TEXT NOT NULL DEFAULT 'create'"],
  ['projects', 'deadline', 'INTEGER'],
  ['projects', 'completion_percent', 'INTEGER NOT NULL DEFAULT 0'],
];

// 失败任务恢复字段（进度 / 阶段 / 错误码 / 重试次数）
const TASK_RETRY_COLUMNS = [
  ['ai_tasks', 'progress', 'INTEGER NOT NULL DEFAULT 0'],
  ['ai_tasks', 'stage', 'TEXT'],
  ['ai_tasks', 'error_code', 'TEXT'],
  ['ai_tasks', 'retry_count', 'INTEGER NOT NULL DEFAULT 0'],
];

// 项目资源归属：先为核心成果补齐 project_id，旧数据保持 NULL，兼容历史记录。
const PROJECT_RESOURCE_COLUMNS = [
  ['generated_docs', 'project_id', 'INTEGER REFERENCES projects(id) ON DELETE SET NULL'],
  ['documents', 'project_id', 'INTEGER REFERENCES projects(id) ON DELETE SET NULL'],
  ['references', 'project_id', 'INTEGER REFERENCES projects(id) ON DELETE SET NULL'],
  ['charts', 'project_id', 'INTEGER REFERENCES projects(id) ON DELETE SET NULL'],
  ['orders', 'project_id', 'INTEGER REFERENCES projects(id) ON DELETE SET NULL'],
];

const EVIDENCE_LIBRARY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS evidence_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_title TEXT NOT NULL DEFAULT '',
    chunk_index INTEGER NOT NULL DEFAULT 0,
    page_number INTEGER,
    section_title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    traceable INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(project_id, source_type, source_id, chunk_index)
  );
  CREATE INDEX IF NOT EXISTS idx_evidence_project ON evidence_chunks(project_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_evidence_source ON evidence_chunks(project_id, source_type, source_id);
`;

const SERVICE_PROJECTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS promotion_partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS promotion_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL COLLATE NOCASE,
    partner_id INTEGER NOT NULL REFERENCES promotion_partners(id) ON DELETE RESTRICT,
    is_active INTEGER NOT NULL DEFAULT 1,
    valid_from INTEGER,
    valid_until INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS service_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_no TEXT UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service_type TEXT NOT NULL CHECK(service_type IN ('thesis_coaching','graduation_project')),
    source_type TEXT NOT NULL,
    source_id INTEGER NOT NULL,
    order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'submitted',
    progress INTEGER NOT NULL DEFAULT 5 CHECK(progress BETWEEN 0 AND 100),
    stage TEXT NOT NULL DEFAULT '需求已提交',
    next_action TEXT NOT NULL DEFAULT '等待平台评估需求',
    eta_at INTEGER,
    request_snapshot_json TEXT NOT NULL DEFAULT '{}',
    promotion_code_id INTEGER REFERENCES promotion_codes(id) ON DELETE SET NULL,
    promotion_code_snapshot TEXT,
    promotion_partner_snapshot TEXT,
    promotion_locked_at INTEGER,
    user_visible_note TEXT NOT NULL DEFAULT '',
    internal_note TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(source_type, source_id)
  );
  CREATE TABLE IF NOT EXISTS service_project_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_project_id INTEGER NOT NULL REFERENCES service_projects(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status TEXT NOT NULL,
    progress INTEGER NOT NULL,
    stage TEXT NOT NULL,
    user_visible_note TEXT NOT NULL DEFAULT '',
    internal_note TEXT NOT NULL DEFAULT '',
    operator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    operator_role TEXT NOT NULL DEFAULT 'system',
    idempotency_key TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(service_project_id, idempotency_key)
  );
  CREATE TABLE IF NOT EXISTS service_project_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_project_id INTEGER NOT NULL REFERENCES service_projects(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('supplement','revision_request','acceptance')),
    content TEXT NOT NULL DEFAULT '',
    idempotency_key TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(service_project_id, idempotency_key)
  );
  CREATE TABLE IF NOT EXISTS service_project_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_project_id INTEGER NOT NULL REFERENCES service_projects(id) ON DELETE CASCADE,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    role TEXT NOT NULL DEFAULT 'supplement' CHECK(role IN ('supplement','deliverable')),
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    deleted_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'service_project',
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    link TEXT,
    event_key TEXT UNIQUE,
    read_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_service_projects_user ON service_projects(user_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_service_projects_status ON service_projects(status, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_service_updates_project ON service_project_updates(service_project_id, id);
  CREATE INDEX IF NOT EXISTS idx_service_attachments_project ON service_project_attachments(service_project_id, id);
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at, id DESC);
  CREATE INDEX IF NOT EXISTS idx_promotion_codes_partner ON promotion_codes(partner_id, is_active);
`;

const OPERATIONAL_METRICS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS operational_metrics (
    bucket_hour INTEGER NOT NULL,
    metric TEXT NOT NULL,
    dimension TEXT NOT NULL DEFAULT '',
    count INTEGER NOT NULL DEFAULT 0,
    total_value REAL NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY(bucket_hour, metric, dimension)
  );
  CREATE INDEX IF NOT EXISTS idx_operational_metrics_name ON operational_metrics(metric, bucket_hour DESC);
`;

const ADMIN_OPERATION_LOG_SCHEMA = `
  CREATE TABLE IF NOT EXISTS admin_operation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_email TEXT NOT NULL DEFAULT '',
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT '',
    target_id TEXT NOT NULL DEFAULT '',
    request_id TEXT NOT NULL DEFAULT '',
    ip_address TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    success INTEGER NOT NULL DEFAULT 0,
    status_code INTEGER NOT NULL DEFAULT 0,
    before_json TEXT,
    after_json TEXT,
    request_json TEXT,
    error_message TEXT NOT NULL DEFAULT '',
    prev_hash TEXT NOT NULL DEFAULT '',
    entry_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_admin_operation_actor ON admin_operation_logs(actor_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_admin_operation_target ON admin_operation_logs(target_type, target_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_admin_operation_action ON admin_operation_logs(action, created_at DESC);
`;

// 守卫式加列：仅当列不存在时 ALTER，保证对旧库幂等
function addColumnIfMissing(db, table, column, def) {
  const tableName = table.replaceAll('"', '');
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  if (!exists) return false;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
  return true;
}

// 迁移注册表：按顺序执行，已应用（version 已记录）则跳过。不要修改已发布版本。
const MIGRATIONS = [
  {
    version: '001_initial',
    name: '初始表结构',
    up(db) {
      // 初始表结构由 db.js 启动时的建表脚本创建（CREATE TABLE IF NOT EXISTS，幂等）。
      // 此处仅做前置断言：users 表必须已存在，否则说明启动顺序异常。
      const t = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
      if (!t) throw new Error('001_initial 前置失败：users 表不存在');
    },
  },
  { version: '002_order_events', name: '订单状态时间线', up(db) { db.exec(ORDER_EVENTS_SCHEMA); } },
  {
    version: '003_project_workflow',
    name: '论文工作区主流程字段',
    up(db) { for (const [t, c, d] of PROJECT_WORKFLOW_COLUMNS) addColumnIfMissing(db, t, c, d); },
  },
  {
    version: '004_task_retry',
    name: '失败任务重试字段',
    up(db) { for (const [t, c, d] of TASK_RETRY_COLUMNS) addColumnIfMissing(db, t, c, d); },
  },
  {
    version: '005_project_resources',
    name: '项目级成果归属',
    up(db) {
      for (const [t, c, d] of PROJECT_RESOURCE_COLUMNS) addColumnIfMissing(db, t === 'references' ? '"references"' : t, c, d);
      const indexes = [
        ['generated_docs', 'CREATE INDEX IF NOT EXISTS idx_generated_docs_project ON generated_docs(project_id, created_at DESC)'],
        ['references', 'CREATE INDEX IF NOT EXISTS idx_references_project ON "references"(project_id, created_at DESC)'],
        ['charts', 'CREATE INDEX IF NOT EXISTS idx_charts_project ON charts(project_id, created_at DESC)'],
        ['orders', 'CREATE INDEX IF NOT EXISTS idx_orders_project ON orders(project_id, created_at DESC)'],
      ];
      for (const [table, sql] of indexes) {
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) db.exec(sql);
      }
    },
  },
  {
    version: '006_evidence_library',
    name: '可追溯证据分块库',
    up(db) {
      addColumnIfMissing(db, '"references"', 'abstract', "TEXT NOT NULL DEFAULT ''");
      db.exec(EVIDENCE_LIBRARY_SCHEMA);
    },
  },
  {
    version: '007_service_projects_and_promotion',
    name: '人工服务项目、推广归因与站内通知',
    up(db) { db.exec(SERVICE_PROJECTS_SCHEMA); },
  },
  {
    version: '008_operational_metrics',
    name: '生产运行指标聚合',
    up(db) { db.exec(OPERATIONAL_METRICS_SCHEMA); },
  },
  {
    version: '009_email_verification',
    name: '邮箱真实性验证',
    up(db) {
      const added = addColumnIfMissing(db, 'users', 'email_verified_at', 'INTEGER');
      if (added) db.prepare('UPDATE users SET email_verified_at=COALESCE(email_verified_at, created_at)').run();
      db.exec(`CREATE TABLE IF NOT EXISTS email_verification_codes (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        sent_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      )`);
    },
  },
  {
    version: '010_admin_operation_log',
    name: '后台与客服操作审计日志',
    up(db) { db.exec(ADMIN_OPERATION_LOG_SCHEMA); },
  },
  {
    version: '011_staff_totp',
    name: '管理员与客服 TOTP 双因素认证',
    up(db) {
      addColumnIfMissing(db, 'users', 'totp_secret_enc', 'TEXT');
      addColumnIfMissing(db, 'users', 'totp_enabled_at', 'INTEGER');
      db.exec(`CREATE TABLE IF NOT EXISTS totp_recovery_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL,
        used_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        UNIQUE(user_id, code_hash)
      );
      CREATE INDEX IF NOT EXISTS idx_totp_recovery_user ON totp_recovery_codes(user_id, used_at);`);
    },
  },
];

export function runMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`);
  const has = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
  const record = db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)');

  for (const m of MIGRATIONS) {
    if (has.get(m.version)) continue;
    const apply = db.transaction(() => {
      m.up(db);
      record.run(m.version, m.name);
    });
    apply();
    logger.info('migration', `已应用迁移 ${m.version} ${m.name}`);
  }
}

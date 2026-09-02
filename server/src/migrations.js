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

// 守卫式加列：仅当列不存在时 ALTER，保证对旧库幂等
function addColumnIfMissing(db, table, column, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
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

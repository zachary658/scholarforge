import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import logger from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 支持 DB_PATH 环境变量指定数据库文件路径（测试 / 多实例部署用，默认 data/scholarforge.db）
const dataDir = process.env.DB_PATH ? dirname(process.env.DB_PATH) : join(__dirname, '..', 'data');
const uploadsDir = join(__dirname, '..', 'uploads');
const docsDir = join(__dirname, '..', 'uploads', 'docs');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

const db = new Database(process.env.DB_PATH || join(dataDir, 'scholarforge.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// 并发写锁等待 5 秒，避免 SQLITE_BUSY 立即报错（webhook 与用户请求并发场景）
db.pragma('busy_timeout = 5000');
// WAL 模式下 synchronous=NORMAL 仍 crash-safe，但减少 fsync 提升写入性能
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    tool_type TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    file_path TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS "references" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    authors TEXT NOT NULL DEFAULT '',
    year TEXT,
    journal TEXT,
    publisher TEXT,
    ref_type TEXT NOT NULL DEFAULT 'journal',
    doi TEXT,
    source TEXT NOT NULL DEFAULT 'web',       -- 来源：web(真实可溯源)/manual(手动)/ai_suggested(AI建议)
    source_url TEXT,                           -- 原文链接（可溯源）
    source_db TEXT,                            -- 来源数据库（如：中国知网 CNKI / IEEE Xplore / Springer Link）
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  -- 系统设置 key-value
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  -- 功能定价表（按功能现金收费：固定价格 fixed / 人工报价 quote）
  CREATE TABLE IF NOT EXISTS feature_prices (
    feature_key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price REAL NOT NULL DEFAULT 0,       -- 现金价格（元）
    unit TEXT NOT NULL DEFAULT '次',
    category TEXT NOT NULL DEFAULT 'writing',
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    is_unlimited INTEGER NOT NULL DEFAULT 0,   -- 1=免费且不限次（如大纲生成）
    pricing_mode TEXT NOT NULL DEFAULT 'fixed', -- fixed=固定价格 / quote=人工报价
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  -- 课程表（论文 1 对 1 指导等服务型商品，管理员后台增删管理）
  CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL DEFAULT 0,
    duration_text TEXT,                        -- 服务时长描述（如"4周"）
    quota_granted INTEGER NOT NULL DEFAULT 0,  -- 兼容旧字段（1对1指导不使用）
    validity_days INTEGER,                     -- 有效期天数（NULL=长期有效）
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  -- 用户购买的课程记录（含剩余免费次数）
  -- order_id: 关联订单，退款时精准定位该笔发放的额度记录
  CREATE TABLE IF NOT EXISTS user_courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    quota_remaining INTEGER NOT NULL DEFAULT 0,
    order_id INTEGER,
    expires_at INTEGER,
    purchased_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  -- 订单统一表（功能按次付费 / 课程 / 毕业作品）
  -- type: feature=功能订单 / course=课程 / graduation=毕业作品
  -- 功能订单状态：pending/awaiting_quote/quoted/paid/processing/completed/cancelled
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'feature',
    target TEXT NOT NULL DEFAULT '',
    target_name TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    payment_method TEXT NOT NULL DEFAULT 'wechat', -- wechat / alipay / manual / mock
    payment_channel TEXT,
    transaction_id TEXT,
    paid_at INTEGER,
    item_type TEXT,
    item_name TEXT,
    quantity INTEGER NOT NULL DEFAULT 1,
    custom_requirements TEXT,
    quoted_price REAL,
    quote_note TEXT,
    service_status TEXT NOT NULL DEFAULT 'pending', -- pending/processing/completed/failed
    task_id INTEGER,
    params_json TEXT,
    metadata TEXT,
    expires_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  -- 格式模板（user_id 为 NULL 表示全局模板；is_preset=1 表示系统预置高校模板）
  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    styles_json TEXT NOT NULL DEFAULT '{}',
    is_global INTEGER NOT NULL DEFAULT 0,
    is_preset INTEGER NOT NULL DEFAULT 0,        -- 1=系统预置（清华/北大/人大等高校模板）
    school_name TEXT,                              -- 学校名称（预置模板专用）
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  -- 生成的 Word 文档存档
  CREATE TABLE IF NOT EXISTS generated_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    feature TEXT NOT NULL,
    file_path TEXT NOT NULL,
    order_id INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  -- 使用日志
  CREATE TABLE IF NOT EXISTS usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    email TEXT,
    name TEXT,
    tool_type TEXT NOT NULL,
    action TEXT NOT NULL,
    model_id INTEGER,
    model_name TEXT,
    mode TEXT,
    input_chars INTEGER DEFAULT 0,
    output_chars INTEGER DEFAULT 0,
    tokens INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'success',
    message TEXT,
    order_id INTEGER,
    charge_type TEXT,
    amount REAL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  -- 论文工作区（项目级上下文容器）
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,                          -- 论文标题
    field TEXT,                                   -- 学科领域
    description TEXT DEFAULT '',                  -- 论文描述/要求
    writing_requirements TEXT DEFAULT '',          -- 写作要求（字数/风格等）
    outline_json TEXT DEFAULT '[]',               -- 结构化大纲 [{chapter, sections:[{title, content}]}]
    status TEXT DEFAULT 'active',                 -- active | archived
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  -- AI 任务历史记录（保存每次调用的完整输入+输出）
  CREATE TABLE IF NOT EXISTS ai_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,  -- 关联论文工作区（可空）
    tool_type TEXT NOT NULL,                     -- writing/proposal/polish/translate/grammar/rewrite/ai_reduce/literature_review/task_book/defense/journal
    action TEXT NOT NULL,                        -- 具体动作
    title TEXT,                                  -- 任务标题（自动生成）
    input_text TEXT NOT NULL DEFAULT '',          -- 完整输入文本
    output_text TEXT NOT NULL DEFAULT '',         -- 完整输出文本
    params_json TEXT DEFAULT '{}',                -- 调用参数（不含大段文本）
    context_summary TEXT DEFAULT '',              -- 使用的上下文摘要
    model_name TEXT,
    tokens INTEGER DEFAULT 0,
    charge_type TEXT,                            -- free_signup/free_course/paid/none
    amount REAL DEFAULT 0,
    order_id INTEGER,
    usage_log_id INTEGER,                        -- 关联 usage_logs 记录
    status TEXT DEFAULT 'success',               -- success/failed
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  -- 索引：加速按用户/项目/工具查询
  CREATE INDEX IF NOT EXISTS idx_ai_tasks_user ON ai_tasks(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ai_tasks_project ON ai_tasks(project_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_usage_logs_user ON usage_logs(user_id, created_at DESC);
  -- 订单表索引：高频查询（按用户查订单、按状态统计、按过期时间清理、按支付时间趋势）
  CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status, id DESC);
  CREATE INDEX IF NOT EXISTS idx_orders_status_paid ON orders(status, paid_at);
  CREATE INDEX IF NOT EXISTS idx_orders_expires_pending ON orders(expires_at) WHERE status = 'pending';
  CREATE INDEX IF NOT EXISTS idx_orders_transaction_id ON orders(transaction_id) WHERE transaction_id IS NOT NULL;
  -- user_courses 索引：按用户查有效额度、按 order_id 退款定位
  CREATE INDEX IF NOT EXISTS idx_user_courses_user ON user_courses(user_id, expires_at);
  CREATE INDEX IF NOT EXISTS idx_user_courses_user_course ON user_courses(user_id, course_id);
  -- usage_logs 时间索引：财务/统计趋势查询
  CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_usage_logs_tool ON usage_logs(tool_type, created_at);
  -- documents 索引
  CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id, updated_at DESC);
  -- references 索引
  CREATE INDEX IF NOT EXISTS idx_references_user ON "references"(user_id, created_at DESC);
  -- generated_docs 索引：按用户/订单查询、按时间清理
  CREATE INDEX IF NOT EXISTS idx_generated_docs_user ON generated_docs(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_generated_docs_order ON generated_docs(order_id);
  CREATE INDEX IF NOT EXISTS idx_generated_docs_created ON generated_docs(created_at);
`);

// ========== 轻量 schema 迁移（兼容已有数据库） ==========
// 注意：references 是 SQLite 关键字，需用引号包裹表名
function addColumnIfMissing(table, column, def) {
  const safeTable = table === 'references' ? '"references"' : table;
  const cols = db.prepare(`PRAGMA table_info(${safeTable})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${safeTable} ADD COLUMN ${column} ${def}`);
  }
}

// 删除列（SQLite 3.35+ 支持 DROP COLUMN；用于移除积分/额度/退款等废弃字段）
function dropColumnIfExists(table, column) {
  const safeTable = table === 'references' ? '"references"' : table;
  const cols = db.prepare(`PRAGMA table_info(${safeTable})`).all().map((c) => c.name);
  if (cols.includes(column)) {
    db.exec(`ALTER TABLE ${safeTable} DROP COLUMN ${column}`);
  }
}
// 注册风控：记录注册 IP 与设备指纹，防止同一 IP/设备反复注册
addColumnIfMissing('users', 'register_ip', 'TEXT');
addColumnIfMissing('users', 'device_fingerprint', 'TEXT');
try {
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_register_ip ON users(register_ip, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_device_fp ON users(device_fingerprint)');
} catch {}
// ===== 移除积分/额度/退款废弃字段（现金直付改造） =====
dropColumnIfExists('users', 'points');
dropColumnIfExists('users', 'free_quota');
dropColumnIfExists('users', 'free_quota_expires_at');
dropColumnIfExists('orders', 'refunded_at');
dropColumnIfExists('orders', 'refund_reason');
db.exec('DROP TABLE IF EXISTS points_log');
db.exec('DROP TABLE IF EXISTS points_packages');

addColumnIfMissing('orders', 'payment_channel', 'TEXT');
addColumnIfMissing('orders', 'transaction_id', 'TEXT');
addColumnIfMissing('orders', 'metadata', 'TEXT');
addColumnIfMissing('orders', 'expires_at', 'INTEGER');
// 现金直付订单字段
addColumnIfMissing('orders', 'item_type', 'TEXT');
addColumnIfMissing('orders', 'item_name', 'TEXT');
addColumnIfMissing('orders', 'quantity', 'INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('orders', 'custom_requirements', 'TEXT');
addColumnIfMissing('orders', 'quoted_price', 'REAL');
addColumnIfMissing('orders', 'quote_note', 'TEXT');
addColumnIfMissing('orders', 'service_status', "TEXT NOT NULL DEFAULT 'pending'");
addColumnIfMissing('orders', 'task_id', 'INTEGER');
addColumnIfMissing('orders', 'params_json', 'TEXT');
// 分章节生成（writing_fulltext）订单生命周期治理：
//   - updated_at：记录订单最近一次被抢占（进入 processing）的时间，用于超时抢占，
//     避免进程崩溃/重启后订单永久卡在 processing（用户永远收到「订单正在生成中」）
//   - project_id：订单绑定到的论文工作区，防「一单多用」（同订单对多个项目白嫖生成/重写）
addColumnIfMissing('orders', 'updated_at', 'INTEGER');
addColumnIfMissing('orders', 'project_id', 'INTEGER');
// 借鉴千笔写作：新增字段
addColumnIfMissing('feature_prices', 'is_unlimited', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('feature_prices', 'pricing_mode', "TEXT NOT NULL DEFAULT 'fixed'");
addColumnIfMissing('references', 'source', "TEXT NOT NULL DEFAULT 'web'");
addColumnIfMissing('references', 'source_url', 'TEXT');
addColumnIfMissing('references', 'source_db', 'TEXT');
addColumnIfMissing('templates', 'is_preset', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('templates', 'school_name', 'TEXT');
// 课程表新增服务时长字段（论文1对1指导）
addColumnIfMissing('courses', 'duration_text', 'TEXT');
// 课程表新增学历字段（本科/硕士/博士等），用于前台按学历分组与定制报价
addColumnIfMissing('courses', 'degree', 'TEXT');
// user_courses 增加 order_id 列：关联订单，退款时精准定位该笔发放的额度记录
addColumnIfMissing('user_courses', 'order_id', 'INTEGER REFERENCES orders(id) ON DELETE SET NULL');
// user_courses 增加 requirements 列：存储用户下单时填写的定制需求与报价明细（JSON）
addColumnIfMissing('user_courses', 'requirements', 'TEXT');
// user_courses 增加 contact_status 列：客服对接状态（pending=待对接 / contacted=已对接）
addColumnIfMissing('user_courses', 'contact_status', "TEXT NOT NULL DEFAULT 'pending'");
// 为 user_courses.order_id 添加索引（退款查询用）
try {
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_courses_order ON user_courses(order_id) WHERE order_id IS NOT NULL');
} catch {}
// generated_docs 增加 order_id 外键列（如果缺失）
addColumnIfMissing('generated_docs', 'order_id', 'INTEGER');
// 金额精度：财务查询统一用 SUM(ROUND(amount*100))/100.0 整数分累加，避免浮点误差；
// 无需额外生成列（此前 amount_cents 虚拟列从未被引用，已移除）
// 客服账号角色：is_support=1 可查看课程对接管理，无完整管理权限
addColumnIfMissing('users', 'is_support', 'INTEGER NOT NULL DEFAULT 0');

// 课程定制价格字段：每个课程可覆盖全局报价规则，NULL=使用全局默认值
addColumnIfMissing('courses', 'custom_base_word_count', 'INTEGER');
addColumnIfMissing('courses', 'custom_word_price', 'REAL');
addColumnIfMissing('courses', 'custom_chart_price', 'REAL');
addColumnIfMissing('courses', 'custom_drawing_price', 'REAL');
addColumnIfMissing('courses', 'custom_formula_low', 'REAL');
addColumnIfMissing('courses', 'custom_formula_mid', 'REAL');
addColumnIfMissing('courses', 'custom_formula_high', 'REAL');
addColumnIfMissing('courses', 'custom_urgent_multiplier', 'REAL');

// ===== 阶段三：大纲强制确认 + 分章节草稿 + 数据图表 =====
addColumnIfMissing('projects', 'outline_confirmed_at', 'INTEGER');
addColumnIfMissing('projects', 'chapters_json', "TEXT DEFAULT '[]'");
// ===== 蒸馏流水线贯通：工作区持久化检索→蒸馏产物（框架/文献/benchmark/表格数据） =====
// sources_json 结构：{ framework, references, benchmarks, tables, sources_used, saved_at }
// 分章节生成与全文生成统一消费，保证蒸馏产物贯通到正文
addColumnIfMissing('projects', 'sources_json', "TEXT DEFAULT '{}'");
// ===== 自动工作区：用户首次生成内容时系统自动创建（auto_created=1），防止内容散落丢失 =====
addColumnIfMissing('projects', 'auto_created', 'INTEGER NOT NULL DEFAULT 0');
// ===== 论文工作区主流程：阶段推进 / 截止时间 / 完成度 =====
addColumnIfMissing('projects', 'degree', 'TEXT');
addColumnIfMissing('projects', 'current_stage', "TEXT NOT NULL DEFAULT 'create'");
addColumnIfMissing('projects', 'deadline', 'INTEGER');
addColumnIfMissing('projects', 'completion_percent', 'INTEGER NOT NULL DEFAULT 0');
// ===== 失败任务恢复：进度 / 阶段 / 错误码 / 重试次数（P0 任务重试路径） =====
addColumnIfMissing('ai_tasks', 'progress', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('ai_tasks', 'stage', 'TEXT');
addColumnIfMissing('ai_tasks', 'error_code', 'TEXT');
addColumnIfMissing('ai_tasks', 'retry_count', 'INTEGER NOT NULL DEFAULT 0');
// ===== 用户上传资料（写作参考材料：docx/pdf/txt 解读后存储文本与 token 量）=====
db.exec(`
  CREATE TABLE IF NOT EXISTS materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    file_type TEXT NOT NULL DEFAULT 'txt',
    text_content TEXT NOT NULL DEFAULT '',
    tokens INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_materials_user ON materials(user_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_materials_project ON materials(project_id);
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS charts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT,
    chart_type TEXT NOT NULL DEFAULT 'bar',
    file_path TEXT NOT NULL,
    spec_json TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_charts_user ON charts(user_id, created_at DESC);
`);

// ===== 毕业作品指导制作模块 =====
db.exec(`
  CREATE TABLE IF NOT EXISTS graduation_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    base_price REAL NOT NULL DEFAULT 0,
    duration_text TEXT,
    degree TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS graduation_project_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES graduation_projects(id) ON DELETE CASCADE,
    requirements TEXT,
    quoted_price REAL,
    status TEXT NOT NULL DEFAULT 'pending',
    contact_status TEXT NOT NULL DEFAULT 'pending',
    order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    purchased_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    expires_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_gp_orders_user ON graduation_project_orders(user_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_gp_orders_project ON graduation_project_orders(project_id);
  CREATE INDEX IF NOT EXISTS idx_gp_orders_contact ON graduation_project_orders(contact_status);
`);

// 毕业作品订单：报价审批状态（none=未报价 / pending=待审批 / approved=已生效 / rejected=已驳回）
// 客服报价进入 pending，管理员审批通过后 approved 才生效（用户方可支付）
addColumnIfMissing('graduation_project_orders', 'quote_status', "TEXT NOT NULL DEFAULT 'none'");

// ===== 专利申请与期刊论文发表服务模块 =====
// 服务型订单：用户提交需求 → 客服对接报价 → 管理员审批 → 用户支付 → 人工服务
db.exec(`
  CREATE TABLE IF NOT EXISTS patent_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    patent_type TEXT NOT NULL DEFAULT 'invention', -- invention=发明专利 / utility=实用新型 / design=外观设计
    title TEXT NOT NULL,
    tech_description TEXT,
    contact TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    contact_status TEXT NOT NULL DEFAULT 'pending',
    quoted_price REAL,
    quote_status TEXT NOT NULL DEFAULT 'none',     -- none/pending/approved/rejected
    order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_patent_orders_user ON patent_orders(user_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_patent_orders_contact ON patent_orders(contact_status);

  CREATE TABLE IF NOT EXISTS publication_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    paper_title TEXT NOT NULL,
    field TEXT,
    journal_level TEXT NOT NULL DEFAULT 'general', -- general=普刊 / core=核心 / sci=SCI
    requirements TEXT,
    contact TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    contact_status TEXT NOT NULL DEFAULT 'pending',
    quoted_price REAL,
    quote_status TEXT NOT NULL DEFAULT 'none',
    order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_pub_orders_user ON publication_orders(user_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_pub_orders_contact ON publication_orders(contact_status);
`);

// ===== 客服跟进备注（沟通时间线）：课程订单与毕业作品订单共用 =====
db.exec(`
  CREATE TABLE IF NOT EXISTS order_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_type TEXT NOT NULL,        -- 'course' | 'graduation'
    order_ref_id INTEGER NOT NULL,   -- user_courses.id 或 graduation_project_orders.id
    author_id INTEGER NOT NULL,
    author_name TEXT,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_order_notes ON order_notes(order_type, order_ref_id, created_at DESC);
`);

// ===== 订单状态时间线（统一状态机每次变更都会落一条事件） =====
// domain: order(订单主状态) / service(服务状态) / contact(客服状态) / quote(报价状态)
// ref_type: 来源表；ref_id: 来源记录 id；operator_id: 操作人（系统事件为 NULL）
db.exec(`
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
`);

// ===== 认证安全：token_version 用于主动失效 JWT（修改密码/登出时 +1）=====
addColumnIfMissing('users', 'token_version', 'INTEGER NOT NULL DEFAULT 0');

// ===== 合规：学术诚信承诺书同意时间（阶段四 4.1）=====
addColumnIfMissing('users', 'academic_integrity_agreed_at', 'INTEGER');

// ===== 认证安全：refresh_tokens 表（可吊销的 refresh token）=====
db.exec(`
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    revoked_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id, expires_at);
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash) WHERE revoked_at IS NULL;
`);

// ===== 认证安全：password_reset_tokens 表（一次性密码重置令牌）=====
db.exec(`
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(token_hash) WHERE used_at IS NULL;
`);

// ========== 种子设置 ==========
const seedSettings = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
const settingsDefaults = {
  site_name: 'ScholarForge',
  site_description: 'AI 驱动的学术论文辅助平台 · 按需付费',
  announcement: '',
  // 客服微信（课程购买等人工咨询用，前台展示，用户添加微信详聊）
  service_wechat: '',
  // 客服微信二维码图片地址（管理员后台上传，前台展示扫码添加）
  service_wechat_qrcode: '',
  registration_open: 'true',
  footer_text: '© 2026 ScholarForge · 仅供学术研究辅助使用',
  // 支付通道：mock / alipay / wechat / mixed
  payment_mode: 'mock',
  // 注册风控：同 IP 24h 最大注册数 / 同设备指纹最大注册数（防批量注册白嫖）
  signup_ip_limit: '3',
  signup_device_limit: '1',
  // AI 计费：大模型成本单价（元/百万 token）与目标利润率
  // 利润率 0.8 = 80%，即售价 = 成本 / (1 - 0.8) = 成本 × 5
  ai_input_cost_per_million: '1',
  ai_output_cost_per_million: '16',
  ai_profit_margin: '0.8',
  // 课程定制报价规则（论文 1 对 1 指导）：基础价来自课程"起"价，需求项在其上累加
  course_quote_base_word_count: '10000',   // 基准字数（字），含在起价内
  course_quote_word_price: '500',          // 每超 1 万字加价（元）
  course_quote_chart_price: '100',         // 每张图表加价（元）
  course_quote_drawing_price: '150',       // 每张图纸/示意图加价（元）
  course_quote_formula_low: '200',         // 公式复杂度：少量
  course_quote_formula_mid: '500',         // 公式复杂度：较多
  course_quote_formula_high: '1000',       // 公式复杂度：大量
  course_quote_urgent_multiplier: '1.3',   // 加急：小计乘以此系数
  // 订单超时（秒），默认 15 分钟
  order_expire_seconds: '900',
  // 文档保留天数
  doc_retention_days: '30',
  // 支付宝当面付配置
  alipay_appid: '',
  alipay_private_key: '',
  alipay_public_key: '',
  alipay_gateway: 'https://openapi.alipay.com/gateway.do',
  alipay_sandbox: 'false',
  // 微信 Native 扫码支付配置
  wechat_appid: '',
  wechat_mch_id: '',
  wechat_api_v3_key: '',
  wechat_serial_no: '',
  wechat_private_key: '',
  wechat_notify_url: '',
};
for (const [k, v] of Object.entries(settingsDefaults)) seedSettings.run(k, v);

// ========== 种子功能定价（现金直付：price 单位为元） ==========
const seedFeature = db.prepare(
  'INSERT OR IGNORE INTO feature_prices (feature_key, name, price, unit, category, description, is_active, is_unlimited, sort_order) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)'
);
const featuresSeed = [
  // writing_outline：大纲生成免费且不限次（引流策略）
  ['writing_outline', '大纲生成', 0, '次', 'writing', '生成论文结构大纲（免费不限次）', 1, 0],
  ['writing_paragraph', '段落续写', 2, '次', 'writing', '续写正文段落', 0, 1],
  ['writing_abstract', '摘要生成', 2, '次', 'writing', '提炼论文摘要', 0, 2],
  ['writing_fulltext', '全文生成', 35, '次', 'writing', '生成完整论文', 0, 3],
  ['proposal', '开题报告撰写', 8, '次', 'writing', '生成结构化开题报告', 0, 4],
  ['polish', '学术润色', 2, '次', 'polish', '学术化语句润色', 0, 5],
  ['translate', '中英翻译', 2, '次', 'translate', '中英双向翻译', 0, 6],
  ['grammar', '语法纠错', 2, '次', 'grammar', '语法问题检测', 0, 7],
  ['ref_search', '文献检索', 0, '次', 'reference', '检索学术文献', 1, 8],
  ['ref_format', '文献格式化', 0, '次', 'reference', '引用格式导出', 1, 9],
  ['rewrite', '重复表达优化', 3, '次', 'polish', '优化重复表达，提升表达多样性', 0, 11],
  ['ai_reduce', '表达自然度优化', 4, '次', 'polish', '识别并优化机械化表达，让文本更自然流畅', 0, 13],
  ['literature_review', '文献综述', 6, '次', 'writing', '生成结构化文献综述，含主题分类与文献引用', 0, 14],
  ['task_book', '任务书生成', 4, '次', 'writing', '生成毕业论文任务书，含进度安排与考核指标', 0, 15],
  ['defense', '答辩PPT+演讲稿', 8, '次', 'writing', '生成答辩PPT大纲与配套演讲稿', 0, 16],
  ['journal', '期刊论文撰写', 100, '次', 'writing', '撰写符合期刊发表规范的完整学术论文', 0, 17],
  // ===== 专利申请 / 论文发表辅助工具 =====
  ['patent_draft', '专利交底书撰写', 29, '次', 'writing', '根据技术方案撰写专利交底书（技术领域/背景/发明内容/实施方式）', 0, 18],
  ['review_reply', '审稿意见回复', 19, '次', 'writing', '根据审稿意见生成逐条回复信', 0, 19],
];
for (const f of featuresSeed) seedFeature.run(...f);

// 下架已废弃的功能（查重检测、AI率检测已移除，仅保留重复表达优化与表达自然度优化）
db.prepare(`UPDATE feature_prices SET is_active = 0 WHERE feature_key IN ('plagiarism', 'ai_check')`).run();

// ========== 高风险产品文案迁移：把「降重/降AI率/消除AI痕迹」替换为合规中性表述 ==========
// 已存在的数据库可能在迁移前用了旧文案，此处统一替换（settings 记录版本，仅执行一次）
const COPY_MIGRATION_KEY = 'migration_compliance_copy_v1';
const copyMigRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(COPY_MIGRATION_KEY);
if (!copyMigRow || copyMigRow.value !== 'done') {
  db.prepare("UPDATE feature_prices SET name = ?, description = ? WHERE feature_key = 'rewrite'")
    .run('重复表达优化', '优化重复表达，提升表达多样性');
  db.prepare("UPDATE feature_prices SET name = ?, description = ? WHERE feature_key = 'ai_reduce'")
    .run('表达自然度优化', '识别并优化机械化表达，让文本更自然流畅');
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, 'done', strftime('%s','now'))").run(COPY_MIGRATION_KEY);
}

// 版本化迁移：把 writing_outline / ref_search / ref_format 标记为 is_unlimited=1（免费不限次）
// 重要：仅在首次迁移时执行，避免覆盖管理员在后台调整过的价格
// 用 settings 表记录迁移版本，已执行则跳过
const MIGRATION_KEY = 'migration_unlimited_features_v1';
const migRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(MIGRATION_KEY);
if (!migRow || migRow.value !== 'done') {
  db.prepare(`UPDATE feature_prices SET is_unlimited = 1, price = 0 WHERE feature_key IN ('writing_outline','ref_search','ref_format') AND is_unlimited = 0`).run();
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, 'done', strftime('%s','now'))").run(MIGRATION_KEY);
}

// ========== 一次性迁移：功能价格 积分 → 现金（现金直付改造，确定性写入） ==========
// 历史数据中 feature_prices.price 为积分值，此处按功能键硬设为现金价（元），仅执行一次
const PRICE_MIGRATION_KEY = 'migration_feature_cash_price_v1';
const priceMigRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(PRICE_MIGRATION_KEY);
if (!priceMigRow || priceMigRow.value !== 'done') {
  const setPrice = db.prepare('UPDATE feature_prices SET price = ?, pricing_mode = ? WHERE feature_key = ?');
  for (const f of featuresSeed) {
    // f = [feature_key, name, price, unit, category, description, is_unlimited, sort_order]
    setPrice.run(f[2], 'fixed', f[0]);
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, 'done', strftime('%s','now'))").run(PRICE_MIGRATION_KEY);
}

// ========== 种子课程（论文 1 对 1 指导） ==========
// 学历字段缺失时按标题回填（兼容旧数据），保证前台可按学历分组
try {
  db.prepare(`UPDATE courses SET degree = '本科' WHERE (degree IS NULL OR degree = '') AND title LIKE '%本科%'`).run();
  db.prepare(`UPDATE courses SET degree = '硕士' WHERE (degree IS NULL OR degree = '') AND title LIKE '%硕士%'`).run();
  db.prepare(`UPDATE courses SET degree = '博士' WHERE (degree IS NULL OR degree = '') AND title LIKE '%博士%'`).run();
  db.prepare(`UPDATE courses SET degree = '其他' WHERE degree IS NULL OR degree = ''`).run();
} catch {}

const courseCount = db.prepare('SELECT COUNT(*) as c FROM courses').get().c;
if (courseCount === 0) {
  const insertCourse = db.prepare(
    'INSERT INTO courses (title, description, price, duration_text, degree, quota_granted, validity_days, is_active, sort_order) VALUES (?, ?, ?, ?, ?, 0, ?, 1, ?)'
  );
  insertCourse.run(
    '论文 1 对 1 指导（本科）',
    '资深导师一对一全程指导：选题把关、大纲搭建、正文逐章修改、格式规范与答辩辅导，直到论文定稿。',
    1999, '4 周', '本科', 90, 0
  );
  insertCourse.run(
    '论文 1 对 1 指导（硕士）',
    '针对硕士学位论文提供深度一对一辅导：选题与研究设计、文献综述、实证方法指导、逐章精修与预答辩演练。',
    3999, '8 周', '硕士', 180, 1
  );
  insertCourse.run(
    '论文 1 对 1 指导（博士）',
    '博士论文全程深度辅导：研究方向规划、核心章节打磨、期刊/会议发表建议、盲审与答辩全流程陪伴。',
    8999, '12 周', '博士', 365, 2
  );
}

// ========== 种子毕业作品指导项目 ==========
const gpCount = db.prepare('SELECT COUNT(*) as c FROM graduation_projects').get().c;
if (gpCount === 0) {
  const insertGP = db.prepare(
    'INSERT INTO graduation_projects (title, category, description, base_price, duration_text, degree, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, 1, ?)'
  );
  insertGP.run('建筑方案设计', '建筑图纸', '毕业设计建筑方案全程指导：概念设计、平面图/立面图/剖面图绘制、效果图制作、设计说明撰写。', 2999, '4-6 周', '本科', 0);
  insertGP.run('结构施工图绘制', '建筑图纸', '建筑结构施工图绘制指导：梁板柱配筋图、基础施工图、节点详图、结构计算书。', 3499, '4-6 周', '本科', 1);
  insertGP.run('机械零件设计与制图', '机械图纸', '机械零件设计指导：三维建模、工程图绘制、公差配合标注、装配图制作。', 2999, '4-6 周', '本科', 2);
  insertGP.run('机械传动系统设计', '机械图纸', '机械传动系统方案设计指导：齿轮/皮带/链传动计算、轴系设计、润滑与密封方案。', 3499, '5-7 周', '本科', 3);
  insertGP.run('MATLAB 仿真建模', '仿真模拟', 'MATLAB/Simulink 仿真建模指导：控制系统仿真、信号处理、数值计算、结果可视化。', 2999, '3-5 周', '本科', 4);
  insertGP.run('有限元分析（FEA）', '仿真模拟', 'ANSYS/Abaqus 有限元分析指导：结构静力学/动力学分析、热分析、模态分析、优化设计。', 3999, '4-6 周', '本科', 5);
  insertGP.run('计算流体力学（CFD）', '仿真模拟', 'Fluent/OpenFOAM 流体仿真指导：流动分析、传热分析、多相流模拟、网格划分。', 4499, '5-7 周', '本科', 6);
  insertGP.run('Web 应用开发', '计算机程序', 'Web 应用毕业设计指导：前后端开发、数据库设计、API 接口、部署上线。', 2999, '4-6 周', '本科', 7);
  insertGP.run('移动 App 开发', '计算机程序', '移动端应用毕业设计指导：Android/iOS 开发、UI 设计、数据持久化、发布流程。', 3499, '4-6 周', '本科', 8);
  insertGP.run('数据分析与可视化', '计算机程序', '数据分析毕业设计指导：Python 数据处理、机器学习模型、可视化大屏、报告撰写。', 2599, '3-5 周', '本科', 9);
  insertGP.run('算法设计与实现', '计算机程序', '算法类毕业设计指导：数据结构设计、算法优化、复杂度分析、实验对比。', 2599, '3-5 周', '本科', 10);
  insertGP.run('PLC 控制系统设计', 'PLC设计', 'PLC 控制系统设计指导：梯形图编程、HMI 人机界面、传感器选型、电气原理图。', 3499, '4-6 周', '本科', 11);
  insertGP.run('PLC 生产线自动化', 'PLC设计', '生产线自动化方案指导：多站联动控制、变频调速、气动控制、故障诊断。', 3999, '5-7 周', '本科', 12);
  insertGP.run('电子电路设计', '其他', '电子电路毕业设计指导：原理图设计、PCB 布局布线、元器件选型、焊接调试。', 2999, '4-6 周', '本科', 13);
  insertGP.run('嵌入式系统开发', '其他', '嵌入式系统设计指导：单片机编程、传感器接口、RTOS 系统、样机调试。', 3499, '4-6 周', '本科', 14);
}

// ========== 预置高校论文格式模板（借鉴千笔写作：内置学校模板） ==========
const presetCount = db.prepare('SELECT COUNT(*) as c FROM templates WHERE is_preset = 1').get().c;
if (presetCount === 0) {
  const presetStyles = JSON.stringify({
    font: { family: 'SimSun', size: 12, latin: 'Times New Roman' },
    heading1: { font: 'SimHei', size: 16, bold: true, align: 'center' },
    heading2: { font: 'SimHei', size: 14, bold: true },
    heading3: { font: 'SimHei', size: 13, bold: true },
    body: { font: 'SimSun', size: 12, lineSpacing: 1.5, indentFirstLine: true },
    citation: 'GB/T 7714',
    margins: { top: 2.54, bottom: 2.54, left: 3.17, right: 3.17 },
  });
  const presets = [
    ['清华大学学位论文模板', '清华大学'],
    ['北京大学学位论文模板', '北京大学'],
    ['中国人民大学学位论文模板', '中国人民大学'],
    ['复旦大学学位论文模板', '复旦大学'],
    ['上海交通大学学位论文模板', '上海交通大学'],
    ['浙江大学学位论文模板', '浙江大学'],
    ['南京大学学位论文模板', '南京大学'],
    ['武汉大学学位论文模板', '武汉大学'],
    ['中山大学学位论文模板', '中山大学'],
    ['GB/T 7714 通用学术模板', '通用'],
  ];
  const insertPreset = db.prepare(
    'INSERT INTO templates (user_id, name, file_path, styles_json, is_global, is_preset, school_name) VALUES (NULL, ?, ?, ?, 1, 1, ?)'
  );
  for (const [name, school] of presets) {
    insertPreset.run(name, `preset://${school}`, presetStyles, school);
  }
}

// ========== 定期清理过期数据 ==========
// 清理过期的 refresh tokens、密码重置令牌、待支付订单、旧文档
export function cleanupStaleData(docRetentionDays = 30) {
  const now = Math.floor(Date.now() / 1000);
  const results = {};
  try {
    // 1. 清理已过期的 refresh tokens
    const r1 = db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?').run(now);
    results.deleted_refresh_tokens = r1.changes;
    // 2. 清理已过期的密码重置令牌
    const r2 = db.prepare('DELETE FROM password_reset_tokens WHERE expires_at < ?').run(now);
    results.deleted_reset_tokens = r2.changes;
    // 3. 清理已吊销超过 7 天的 refresh tokens
    const sevenDaysAgo = now - 7 * 86400;
    const r3 = db.prepare('DELETE FROM refresh_tokens WHERE revoked_at IS NOT NULL AND revoked_at < ?').run(sevenDaysAgo);
    results.deleted_revoked_tokens = r3.changes;
    // 4. 清理过期的待支付订单（超过 24 小时未支付）
    const oneDayAgo = now - 86400;
    const r4 = db.prepare("DELETE FROM orders WHERE status = 'pending' AND created_at < ?").run(oneDayAgo);
    results.deleted_expired_orders = r4.changes;
    // 5. 清理旧文档记录（保留最近 N 天）
    const docCutoff = now - docRetentionDays * 86400;
    const oldDocs = db.prepare('SELECT id, file_path FROM generated_docs WHERE created_at < ?').all(docCutoff);
    for (const doc of oldDocs) {
      try {
        if (doc.file_path && fs.existsSync(doc.file_path)) fs.unlinkSync(doc.file_path);
      } catch {}
    }
    const r5 = db.prepare('DELETE FROM generated_docs WHERE created_at < ?').run(docCutoff);
    results.deleted_old_docs = r5.changes;
    // 6. 清理旧任务记录（与文档保留期一致，默认 30 天）
    const taskCutoff = now - docRetentionDays * 86400;
    const r6 = db.prepare('DELETE FROM ai_tasks WHERE created_at < ?').run(taskCutoff);
    results.deleted_old_tasks = r6.changes;
    // 7. 清理旧使用日志（保留 180 天）
    const logCutoff = now - 180 * 86400;
    const r7 = db.prepare('DELETE FROM usage_logs WHERE created_at < ?').run(logCutoff);
    results.deleted_old_logs = r7.changes;
    // 8. VACUUM 回收空间（仅在清理后执行）
    db.pragma('incremental_vacuum');
    logger.info('cleanup', `清理完成: ${JSON.stringify(results)}`);
  } catch (err) {
    logger.error('cleanup', `清理失败: ${err.message}`);
  }
  return results;
}

export default db;

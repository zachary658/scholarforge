import { Router } from 'express';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join, extname, resolve } from 'path';
import fs from 'fs';
import db from '../db.js';
import { adminRequired } from '../middleware.js';
import {
  getAllSettings,
  getSetting,
  setSetting,
  getModels,
  getFeaturePrices,
  getCourses,
  getCourse,
  getPaymentConfig,
  invalidatePaymentCache,
  invalidateSiteCache,
} from '../config-store.js';
import { hashPassword, revokeAllRefreshTokens } from '../auth.js';
import { getModelPreset, getModelKeyFromEnv } from '../model-catalog.js';
import { closePendingGraduationOrders, adminQuoteOrder, markOrderPaid } from '../services/payment.js';
import { parseTemplate } from '../services/template-parser.js';
import logger from '../logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(__dirname, '..', '..', 'uploads', 'templates');
const templatesRoot = resolve(templatesDir);

// 安全拼接模板文件路径：校验解析后的绝对路径仍在 templatesDir 下，防路径遍历
function safeTemplatePath(storedPath) {
  if (!storedPath || typeof storedPath !== 'string') return null;
  if (storedPath.includes('..') || storedPath.includes('\0')) return null;
  const abs = resolve(join(templatesDir, storedPath));
  if (abs !== templatesRoot && !abs.startsWith(templatesRoot + '/')) return null;
  return abs;
}

const router = Router();

// 所有管理员路由都需要 admin 权限
router.use(adminRequired);

// 模板上传配置
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, templatesDir),
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase();
      const safe = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
      cb(null, safe);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.docx')) {
      return cb(new Error('仅支持 .docx 格式模板文件'));
    }
    cb(null, true);
  },
});

// 客服微信二维码上传配置（存到公开目录，前台展示扫码添加）
const publicDir = join(__dirname, '..', '..', 'uploads', 'public');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
const qrcodeUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, publicDir),
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase();
      cb(null, `wechat-qrcode-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
      return cb(new Error('仅支持 png/jpg/jpeg/webp 图片'));
    }
    cb(null, true);
  },
});

import { now, assertSafeAiBaseUrl, checkFileSignature, FILE_SIGNATURES } from '../utils.js';

const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
};

// 金额整数累加表达式：ROUND(amount*100) 转整数分累加，/100.0 转回元，避免浮点累加误差
const AMOUNT_SUM = 'COALESCE(SUM(ROUND(amount*100)),0)/100.0';

// ========== 概览统计 ==========
router.get('/overview', (_req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users WHERE is_admin = 0').get().c;
  const todayTs = today();
  const newToday = db.prepare('SELECT COUNT(*) as c FROM users WHERE created_at >= ? AND is_admin = 0').get(todayTs).c;

  const totalCalls = db.prepare('SELECT COUNT(*) as c FROM usage_logs').get().c;
  const callsToday = db.prepare('SELECT COUNT(*) as c FROM usage_logs WHERE created_at >= ?').get(todayTs).c;
  const successCalls = db.prepare("SELECT COUNT(*) as c FROM usage_logs WHERE status = 'success'").get().c;
  const failedCalls = db.prepare("SELECT COUNT(*) as c FROM usage_logs WHERE status = 'failed'").get().c;
  const totalTokens = db.prepare('SELECT COALESCE(SUM(tokens),0) as s FROM usage_logs').get().s;

  // 按工具统计
  const byTool = db.prepare(
    "SELECT tool_type, COUNT(*) as count FROM usage_logs WHERE status='success' GROUP BY tool_type ORDER BY count DESC"
  ).all();

  // 近 7 天趋势
  const sevenDaysAgo = todayTs - 6 * 86400;
  const trend = db.prepare(
    `SELECT strftime('%Y-%m-%d', created_at, 'unixepoch', 'localtime') as day, COUNT(*) as calls
     FROM usage_logs WHERE created_at >= ? GROUP BY day ORDER BY day ASC`
  ).all(sevenDaysAgo);

  // 真实收入统计（基于订单，整数分累加避免浮点误差）
  const revenueToday = db.prepare(
    `SELECT ${AMOUNT_SUM} as s FROM orders WHERE status = 'paid' AND paid_at >= ?`
  ).get(todayTs).s;
  const revenueWeek = db.prepare(
    `SELECT ${AMOUNT_SUM} as s FROM orders WHERE status = 'paid' AND paid_at >= ?`
  ).get(todayTs - 7 * 86400).s;
  const revenueMonth = db.prepare(
    `SELECT ${AMOUNT_SUM} as s FROM orders WHERE status = 'paid' AND paid_at >= ?`
  ).get(todayTs - 30 * 86400).s;
  const revenueTotal = db.prepare(`SELECT ${AMOUNT_SUM} as s FROM orders WHERE status = 'paid'`).get().s;

  // 订单数（现金直付订单模型）
  const ordersToday = db.prepare("SELECT COUNT(*) as c FROM orders WHERE paid_at >= ?").get(todayTs).c;
  const pendingOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'").get().c;
  const awaitingQuoteOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'awaiting_quote'").get().c;
  const quotedOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'quoted'").get().c;

  // 活跃用户（近 7 天有调用）
  const activeUsers = db.prepare(
    "SELECT COUNT(DISTINCT user_id) as c FROM usage_logs WHERE created_at >= ? AND user_id IS NOT NULL"
  ).get(sevenDaysAgo).c;

  res.json({
    users: { total: totalUsers, newToday, active: activeUsers },
    calls: { total: totalCalls, today: callsToday, success: successCalls, failed: failedCalls },
    tokens: totalTokens,
    revenue: { today: revenueToday, week: revenueWeek, month: revenueMonth, total: revenueTotal },
    orders: { today: ordersToday, pending: pendingOrders, awaiting_quote: awaitingQuoteOrders, quoted: quotedOrders },
    byTool,
    trend,
  });
});

// ========== 功能定价管理（现金直付：fixed 固定价 / quote 人工报价） ==========
router.get('/features', (_req, res) => {
  const features = getFeaturePrices();
  res.json({ features });
});

router.post('/features', (req, res) => {
  const { feature_key, name, price, unit, category, description, is_active, is_unlimited, pricing_mode, sort_order } = req.body || {};
  if (!feature_key || !name) return res.status(400).json({ error: '请填写功能 key 和名称' });
  const unlimited = !!is_unlimited;
  let finalPrice = Number(price) || 0;
  if (unlimited) {
    // 免费功能价格强制为 0
    finalPrice = 0;
  } else if (finalPrice <= 0) {
    return res.status(400).json({ error: '收费功能价格必须大于 0 元' });
  }
  const mode = pricing_mode === 'quote' ? 'quote' : 'fixed';
  db.prepare(
    `INSERT INTO feature_prices (feature_key, name, price, unit, category, description, is_active, is_unlimited, pricing_mode, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(feature_key) DO UPDATE SET
       name=excluded.name, price=excluded.price, unit=excluded.unit,
       category=excluded.category, description=excluded.description,
       is_active=excluded.is_active, is_unlimited=excluded.is_unlimited, pricing_mode=excluded.pricing_mode, sort_order=excluded.sort_order,
       updated_at=strftime('%s','now')`
  ).run(
    feature_key, name, finalPrice, unit || '次', category || 'writing',
    description || '', is_active === false ? 0 : 1, unlimited ? 1 : 0, mode, sort_order ?? 0
  );
  const saved = getFeaturePrices().find((f) => f.feature_key === feature_key);
  res.json({ ok: true, feature: saved });
});

router.delete('/features/:key', (req, res) => {
  // 内置功能不可删除，只能停用
  const builtin = ['writing_outline', 'writing_paragraph', 'writing_abstract', 'writing_fulltext', 'proposal', 'polish', 'translate', 'grammar'];
  if (builtin.includes(req.params.key)) {
    return res.status(400).json({ error: '内置功能不可删除，可停用' });
  }
  db.prepare('DELETE FROM feature_prices WHERE feature_key = ?').run(req.params.key);
  res.json({ ok: true });
});

// ========== 课程管理（论文 1 对 1 指导） ==========
router.get('/courses', (_req, res) => {
  res.json({ courses: getCourses() });
});

router.post('/courses', (req, res) => {
  const { id, title, description, price, duration_text, degree, validity_days, is_active, sort_order,
    custom_base_word_count, custom_word_price, custom_chart_price, custom_drawing_price,
    custom_formula_low, custom_formula_mid, custom_formula_high, custom_urgent_multiplier } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: '请填写课程名称' });
  const vd = validity_days === undefined || validity_days === null || validity_days === ''
    ? null : Number(validity_days);
  const deg = String(degree || '').trim() || null;
  // 自定义报价字段：空字符串 → NULL，数字 → 原值
  const numOrNull = (v) => (v === '' || v === undefined || v === null) ? null : Number(v);
  const cbc = numOrNull(custom_base_word_count);
  const cwp = numOrNull(custom_word_price);
  const ccp = numOrNull(custom_chart_price);
  const cdp = numOrNull(custom_drawing_price);
  const cfl = numOrNull(custom_formula_low);
  const cfm = numOrNull(custom_formula_mid);
  const cfh = numOrNull(custom_formula_high);
  const cum = numOrNull(custom_urgent_multiplier);

  if (id) {
    db.prepare(
      `UPDATE courses SET
         title = ?, description = ?, price = ?, duration_text = ?, degree = ?,
         validity_days = ?, is_active = ?, sort_order = ?,
         custom_base_word_count = ?, custom_word_price = ?, custom_chart_price = ?,
         custom_drawing_price = ?, custom_formula_low = ?, custom_formula_mid = ?,
         custom_formula_high = ?, custom_urgent_multiplier = ?,
         updated_at = strftime('%s','now')
       WHERE id = ?`
    ).run(
      String(title).trim(), description || '', Number(price) || 0, duration_text || null, deg,
      vd, is_active === false ? 0 : 1, Number(sort_order) || 0,
      cbc, cwp, ccp, cdp, cfl, cfm, cfh, cum, id
    );
    return res.json({ ok: true, course: getCourse(id) });
  }
  const info = db.prepare(
    `INSERT INTO courses (title, description, price, duration_text, degree, validity_days, is_active, sort_order,
      custom_base_word_count, custom_word_price, custom_chart_price, custom_drawing_price,
      custom_formula_low, custom_formula_mid, custom_formula_high, custom_urgent_multiplier)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    String(title).trim(), description || '', Number(price) || 0, duration_text || null, deg,
    vd, is_active === false ? 0 : 1, Number(sort_order) || 0,
    cbc, cwp, ccp, cdp, cfl, cfm, cfh, cum
  );
  res.json({ ok: true, course: getCourse(info.lastInsertRowid) });
});

router.delete('/courses/:id', (req, res) => {
  db.prepare('DELETE FROM courses WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ========== 课程对接管理（客服查看已支付课程订单 + 需求 + 标记对接状态） ==========
router.get('/course-orders', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = Math.min(100, Math.max(10, parseInt(req.query.size) || 20));
  const status = (req.query.status || '').toString();
  const offset = (page - 1) * size;
  let where = 'WHERE 1=1';
  const params = [];
  if (['pending', 'contacted', 'completed'].includes(status)) {
    where += ' AND uc.contact_status = ?';
    params.push(status);
  }
  const total = db.prepare(
    `SELECT COUNT(*) as c FROM user_courses uc JOIN users u ON u.id = uc.user_id JOIN courses c ON c.id = uc.course_id ${where}`
  ).get(...params).c;
  const rows = db.prepare(
    `SELECT uc.id, uc.contact_status, uc.purchased_at, uc.expires_at, uc.requirements,
            u.name AS user_name, u.email AS user_email,
            c.title AS course_title, c.degree,
            o.order_no, o.amount
     FROM user_courses uc
     JOIN users u ON u.id = uc.user_id
     JOIN courses c ON c.id = uc.course_id
     LEFT JOIN orders o ON o.id = uc.order_id
     ${where}
     ORDER BY uc.id DESC LIMIT ? OFFSET ?`
  ).all(...params, size, offset);
  const items = rows.map((r) => {
    let requirements = null;
    try { requirements = r.requirements ? JSON.parse(r.requirements) : null; } catch { requirements = null; }
    return { ...r, requirements };
  });
  res.json({ items, total, page, size, pages: Math.ceil(total / size) });
});

router.put('/course-orders/:id/contact-status', (req, res) => {
  const { status } = req.body || {};
  if (!['pending', 'contacted', 'completed'].includes(status)) return res.status(400).json({ error: '无效的对接状态' });
  const row = db.prepare('SELECT id FROM user_courses WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '课程订单不存在' });
  db.prepare('UPDATE user_courses SET contact_status = ? WHERE id = ?').run(status, row.id);
  res.json({ ok: true, id: row.id, contact_status: status });
});

// ========== 订单管理 ==========
router.get('/orders', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = Math.min(100, Math.max(20, parseInt(req.query.size) || 50));
  const status = (req.query.status || '').toString();
  const type = (req.query.type || '').toString();
  const q = (req.query.q || '').toString().trim();
  const offset = (page - 1) * size;
  let where = 'WHERE 1=1';
  const params = [];
  if (status) { where += ' AND o.status = ?'; params.push(status); }
  if (type) { where += ' AND o.type = ?'; params.push(type); }
  if (q) {
    where += ' AND (o.order_no LIKE ? OR o.target_name LIKE ? OR u.email LIKE ? OR u.name LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const total = db.prepare(
    `SELECT COUNT(*) as c FROM orders o LEFT JOIN users u ON u.id = o.user_id ${where}`
  ).get(...params).c;
  const orders = db.prepare(
    `SELECT o.*, u.email as user_email, u.name as user_name
     FROM orders o LEFT JOIN users u ON u.id = o.user_id
     ${where} ORDER BY o.id DESC LIMIT ? OFFSET ?`
  ).all(...params, size, offset);
  res.json({
    orders: orders.map((o) => ({ ...o, metadata: undefined })),
    total, page, size, pages: Math.ceil(total / size),
  });
});

// 管理员报价：更新 quoted_price / quote_note，状态变为 quoted
router.post('/orders/:id/quote', (req, res) => {
  const { quoted_price, quote_note } = req.body || {};
  try {
    const order = adminQuoteOrder(Number(req.params.id), quoted_price, quote_note || '');
    res.json({ ok: true, order });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 手动标记支付（测试备用）：逻辑与真实回调一致但不验证签名
router.post('/orders/:id/mark-paid', async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  try {
    const result = await markOrderPaid({
      orderNo: order.order_no,
      transactionId: `manual_${Date.now()}`,
      channel: 'manual',
    });
    res.json({ ok: true, order: result.order });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ========== 模板管理（全局模板） ==========
router.get('/templates', (_req, res) => {
  const items = db.prepare(
    'SELECT id, user_id, name, file_path, styles_json, is_global, created_at FROM templates ORDER BY is_global DESC, id DESC'
  ).all();
  res.json({ templates: items.map((t) => ({ ...t, styles_json: undefined })) });
});

// 管理员上传全局模板
router.post('/templates/upload', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: '请选择文件' });
    const name = (req.body.name || req.file.originalname.replace(/\.docx$/i, '')).toString().slice(0, 100);
    try {
      const result = await parseTemplate(req.file.path);
      if (!result.ok) {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(400).json({ error: result.error || '模板解析失败' });
      }
      const info = db.prepare(
        'INSERT INTO templates (user_id, name, file_path, styles_json, is_global) VALUES (?, ?, ?, ?, 1)'
      ).run(req.user.id, name, req.file.filename, JSON.stringify(result.styles));
      res.json({ ok: true, id: info.lastInsertRowid, name, is_global: true });
    } catch (e) {
      try { fs.unlinkSync(req.file.path); } catch {}
      res.status(400).json({ error: '模板解析失败：' + e.message });
    }
  });
});

router.delete('/templates/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '模板不存在' });
  const filePath = safeTemplatePath(t.file_path);
  if (filePath) {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }
  db.prepare('DELETE FROM templates WHERE id = ?').run(t.id);
  res.json({ ok: true });
});

// ========== AI 模型管理（预设目录 + 环境变量 Key） ==========
// 安全设计：API Key 一律通过环境变量注入（LLM_API_KEY_<KEY 大写>，见 model-catalog.js），
// 不存储在数据库、不返回给前端。管理后台只做「选择默认模型」与「测试连接」，
// 不提供 Key 的录入/编辑/存储，从源头杜绝 Key 因拖库/配置失误泄露或被前端截获。
// 新增模型：在 model-catalog.js 追加预设 + 配置对应环境变量即可，无需改动本接口。

router.get('/models', (_req, res) => {
  // getModels() 已脱敏：仅返回是否已配置（api_key_configured / api_key_masked），不含 Key 明文
  res.json({ models: getModels() });
});

// 设置默认模型（仅接受内置预设的 key）
router.put('/models/default', (req, res) => {
  const { key } = req.body || {};
  if (!key) return res.status(400).json({ error: '请指定模型' });
  if (!getModelPreset(key)) return res.status(400).json({ error: '未知的模型，请检查模型目录' });
  setSetting('ai_default_model', key);
  res.json({ ok: true, default_key: key });
});

// 测试模型连通性（Key 从环境变量读取，测试过程不返回任何 Key 信息）
router.post('/models/:key/test', async (req, res) => {
  const preset = getModelPreset(req.params.key);
  if (!preset) return res.status(404).json({ error: '模型不存在' });
  const apiKey = getModelKeyFromEnv(preset);
  if (!apiKey) {
    return res.json({ ok: false, message: `未配置 ${preset.env_key} 环境变量` });
  }
  // SSRF 防护：校验 base_url 仅允许 http/https 且非云元数据/回环/链路本地
  try {
    assertSafeAiBaseUrl(preset.base_url);
  } catch (err) {
    return res.json({ ok: false, message: err.message });
  }
  try {
    const url = preset.base_url.replace(/\/$/, '') + '/chat/completions';
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: preset.model_name,
        messages: [{ role: 'user', content: '请回复"连接成功"四个字。' }],
        max_tokens: 20,
      }),
      // 30 秒超时，防止上游慢响应挂起连接
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) {
      // 仅记录上游状态码，不回传响应体（可能含敏感信息）
      logger.error('admin', `model-test upstream HTTP ${r.status}`);
      return res.json({ ok: false, message: `上游返回 HTTP ${r.status}，请检查配置` });
    }
    const data = await r.json();
    const reply = data.choices?.[0]?.message?.content || '';
    res.json({ ok: true, message: '连接成功', reply: reply.slice(0, 80), usedRealAI: true });
  } catch (err) {
    // 脱敏：超时/网络错误返回通用提示，不暴露内部细节
    const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    res.json({ ok: false, message: isTimeout ? '连接超时，请检查网络或 Base URL' : '连接失败，请检查配置' });
  }
});

// ========== 系统设置 ==========
// 允许的设置项白名单
const SETTINGS_WHITELIST = new Set([
  'site_name', 'site_description', 'announcement', 'registration_open', 'footer_text',
  'service_wechat', 'service_wechat_qrcode',
  'icp_number', 'icp_link',
  'signup_ip_limit', 'signup_device_limit',
  'ai_input_cost_per_million', 'ai_output_cost_per_million', 'ai_profit_margin',
  'payment_mode', 'order_expire_seconds', 'doc_retention_days',
  'course_quote_base_word_count', 'course_quote_word_price', 'course_quote_chart_price', 'course_quote_drawing_price',
  'course_quote_formula_low', 'course_quote_formula_mid', 'course_quote_formula_high', 'course_quote_urgent_multiplier',
  'alipay_appid', 'alipay_private_key', 'alipay_private_key_path', 'alipay_public_key', 'alipay_public_key_path', 'alipay_gateway', 'alipay_sandbox',
  'wechat_appid', 'wechat_mch_id', 'wechat_api_v3_key', 'wechat_serial_no', 'wechat_private_key', 'wechat_private_key_path', 'wechat_notify_url', 'wechat_platform_public_key', 'wechat_platform_public_key_path', 'wechat_platform_serial_no',
  'content_safety_provider', 'aliyun_access_key_id', 'aliyun_access_key_secret', 'yidun_secret_id', 'yidun_secret_key', 'yidun_business_id',
]);

const SENSITIVE_KEYS = new Set([
  'alipay_private_key', 'alipay_private_key_path', 'alipay_public_key', 'alipay_public_key_path', 'wechat_api_v3_key', 'wechat_private_key', 'wechat_private_key_path', 'wechat_platform_public_key', 'wechat_platform_public_key_path',
  'aliyun_access_key_secret', 'yidun_secret_key',
]);

router.get('/settings', (_req, res) => {
  const all = getAllSettings();
  // 脱敏：支付密钥只返回是否已配置
  const masked = { ...all };
  for (const k of SENSITIVE_KEYS) {
    if (masked[k]) masked[k] = '已配置';
  }
  res.json({ settings: masked });
});

// 数值型设置项的合法范围（min/max/是否整数）
const NUMERIC_SETTINGS = {
  signup_ip_limit: { min: 0, max: 100, integer: true },
  signup_device_limit: { min: 0, max: 10, integer: true },
  ai_input_cost_per_million: { min: 0, max: 1000 },
  ai_output_cost_per_million: { min: 0, max: 1000 },
  ai_profit_margin: { min: 0, max: 0.99 },
  course_quote_base_word_count: { min: 0, max: 1000000, integer: true },
  course_quote_word_price: { min: 0, max: 100000 },
  course_quote_chart_price: { min: 0, max: 100000 },
  course_quote_drawing_price: { min: 0, max: 100000 },
  course_quote_formula_low: { min: 0, max: 100000 },
  course_quote_formula_mid: { min: 0, max: 100000 },
  course_quote_formula_high: { min: 0, max: 100000 },
  course_quote_urgent_multiplier: { min: 1, max: 10 },
  order_expire_seconds: { min: 60, max: 86400, integer: true },
  doc_retention_days: { min: 1, max: 3650, integer: true },
};
const BOOL_SETTINGS = new Set(['registration_open', 'alipay_sandbox']);
const ENUM_SETTINGS = {
  payment_mode: ['mock', 'alipay', 'wechat', 'mixed'],
  content_safety_provider: ['local', 'aliyun', 'yidun'],
};

// 校验单个设置项的值合法性，返回错误信息或 null
function validateSettingValue(key, value) {
  if (NUMERIC_SETTINGS[key]) {
    const spec = NUMERIC_SETTINGS[key];
    const num = Number(value);
    if (!Number.isFinite(num)) return `${key} 必须是数字`;
    if (spec.integer && !Number.isInteger(num)) return `${key} 必须是整数`;
    if (num < spec.min || num > spec.max) return `${key} 取值范围 ${spec.min}~${spec.max}`;
    return null;
  }
  if (BOOL_SETTINGS.has(key)) {
    if (!['true', 'false'].includes(String(value))) return `${key} 必须是 true 或 false`;
    return null;
  }
  if (ENUM_SETTINGS[key]) {
    if (!ENUM_SETTINGS[key].includes(String(value))) return `${key} 取值范围 ${ENUM_SETTINGS[key].join('/')}`;
    return null;
  }
  return null;
}

router.put('/settings', (req, res) => {
  const obj = req.body || {};
  // 先统一校验所有值，任意一项非法即拒绝（不部分写入，保证配置一致性）
  const errors = [];
  const accepted = {};
  for (const [k, v] of Object.entries(obj)) {
    // 白名单校验
    if (!SETTINGS_WHITELIST.has(k)) continue;
    // 跳过脱敏占位符（前端回传的密钥占位）
    if (v === '已配置') continue;
    const err = validateSettingValue(k, v);
    if (err) {
      errors.push(err);
      continue;
    }
    accepted[k] = v;
  }
  if (errors.length > 0) {
    return res.status(400).json({ error: '设置校验失败：' + errors.join('；') });
  }
  for (const [k, v] of Object.entries(accepted)) {
    setSetting(k, v);
  }
  // 支付配置变更时使缓存失效
  const hasPaymentChange = Object.keys(accepted).some((k) => k.startsWith('payment_') || k.startsWith('alipay_') || k.startsWith('wechat_') || k.startsWith('order_') || k.startsWith('doc_'));
  if (hasPaymentChange) invalidatePaymentCache();
  // 站点信息变更时使公开站点缓存失效（含 ICP 备案、页脚、注册开关等）
  const SITE_KEYS = ['site_name', 'site_description', 'announcement', 'footer_text', 'service_wechat', 'service_wechat_qrcode', 'icp_number', 'icp_link', 'registration_open'];
  const hasSiteChange = Object.keys(accepted).some((k) => SITE_KEYS.includes(k));
  if (hasSiteChange) invalidateSiteCache();
  res.json({ ok: true });
});

// ========== 客服微信二维码 ==========
// 上传二维码图片：保存到公开目录，返回可访问的 URL 路径
router.post('/settings/wechat-qrcode', (req, res) => {
  qrcodeUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: '请选择图片文件' });
    // magic-byte 校验：文件头必须匹配图片格式，防止伪造扩展名上传 HTML/SVG 等
    if (!checkFileSignature(req.file.path, [FILE_SIGNATURES.png, FILE_SIGNATURES.jpeg, FILE_SIGNATURES.webp])) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      return res.status(400).json({ error: '图片文件内容无效' });
    }
    const url = `/uploads/${req.file.filename}`;
    // 删除旧二维码文件，避免残留
    const old = getSetting('service_wechat_qrcode', '');
    if (old && old.startsWith('/uploads/')) {
      try { fs.unlinkSync(join(publicDir, old.slice('/uploads/'.length))); } catch {}
    }
    setSetting('service_wechat_qrcode', url);
    res.json({ ok: true, url });
  });
});

// 移除二维码
router.delete('/settings/wechat-qrcode', (req, res) => {
  const old = getSetting('service_wechat_qrcode', '');
  if (old && old.startsWith('/uploads/')) {
    try { fs.unlinkSync(join(publicDir, old.slice('/uploads/'.length))); } catch {}
  }
  setSetting('service_wechat_qrcode', '');
  res.json({ ok: true });
});

// ========== 用户管理 ==========
router.get('/users', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = Math.min(100, Math.max(10, parseInt(req.query.size) || 20));
  const q = (req.query.q || '').toString().trim();
  const offset = (page - 1) * size;
  let where = 'WHERE 1=1';
  const params = [];
  if (q) {
    where += ' AND (email LIKE ? OR name LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  const total = db.prepare(`SELECT COUNT(*) as c FROM users ${where}`).get(...params).c;
  // 单条 JOIN 聚合查询，避免 N+1（原实现每个用户 3 次子查询）
  const users = db.prepare(
    `SELECT u.id, u.email, u.name, u.is_admin, u.is_support, u.status, u.created_at,
            COALESCE(o.paid_orders, 0) as paid_orders,
            COALESCE(o.total_spent, 0) as total_spent,
            COALESCE(l.total_calls, 0) as total_calls
     FROM users u
     LEFT JOIN (SELECT user_id, COUNT(*) as paid_orders, SUM(ROUND(amount*100))/100.0 as total_spent
                FROM orders WHERE status = 'paid' GROUP BY user_id) o ON o.user_id = u.id
     LEFT JOIN (SELECT user_id, COUNT(*) as total_calls
                FROM usage_logs GROUP BY user_id) l ON l.user_id = u.id
     ${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, size, offset);
  const enriched = users.map((u) => ({
    ...u,
    is_admin: !!u.is_admin,
    is_support: !!u.is_support,
  }));
  res.json({
    users: enriched,
    total, page, size, pages: Math.ceil(total / size),
  });
});

// 管理员手动开通课程（无需支付，用于赠课/补发）
router.post('/users/:id/grant-course', (req, res) => {
  const { course_id, validity_days } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  const course = getCourse(parseInt(course_id, 10));
  if (!course) return res.status(400).json({ error: '课程不存在' });
  const vd = validity_days === undefined || validity_days === null || validity_days === ''
    ? course.validity_days : Number(validity_days);
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = vd ? nowSec + vd * 86400 : null;
  db.prepare(
    `INSERT INTO user_courses (user_id, course_id, quota_remaining, order_id, expires_at, purchased_at)
     VALUES (?, ?, 0, NULL, ?, ?)`
  ).run(u.id, course.id, expiresAt, nowSec);
  res.json({ ok: true, message: `已为 ${u.name} 开通课程「${course.title}」` });
});

router.put('/users/:id', (req, res) => {
  const { status, is_admin, is_support } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  // 防止管理员误禁用/降级自己，导致系统失去可用管理员
  if (u.id === req.user.id && (status === 'banned' || is_admin === false)) {
    return res.status(400).json({ error: '不可禁用或取消自己的管理员权限' });
  }
  // 超级管理员账号不可被降级或禁用
  if (u.email === 'admin@scholarforge.com' && (status === 'banned' || is_admin === false)) {
    return res.status(400).json({ error: '不可降级或禁用超级管理员' });
  }
  db.prepare(
    `UPDATE users SET
       status = COALESCE(?, status),
       is_admin = COALESCE(?, is_admin),
       is_support = COALESCE(?, is_support)
     WHERE id = ?`
  ).run(
    status ?? null,
    is_admin === undefined ? null : (is_admin ? 1 : 0),
    is_support === undefined ? null : (is_support ? 1 : 0),
    u.id
  );
  res.json({ ok: true });
});

router.delete('/users/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  if (u.id === req.user.id) return res.status(400).json({ error: '不可删除自己' });
  if (u.email === 'admin@scholarforge.com') return res.status(400).json({ error: '不可删除超级管理员' });
  // 软删除：仅将状态置为 deleted，保留订单/积分日志等财务记录（原硬删除会级联销毁，破坏对账）
  db.prepare("UPDATE users SET status = 'deleted' WHERE id = ?").run(u.id);
  // 吊销其所有 refresh token，防止已登录会话继续使用
  try {
    revokeAllRefreshTokens(u.id);
  } catch { /* 忽略吊销失败 */ }
  res.json({ ok: true });
});

router.post('/users', async (req, res) => {
  const { email, password, name, is_admin, is_support } = req.body || {};
  if (!email || !password || !name) return res.status(400).json({ error: '请填写邮箱、密码、昵称' });
  // 邮箱归一化：与注册/登录保持一致（转小写 + 去空格 + 格式校验），防大小写/空格绕过唯一约束
  const normalizedEmail = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: '邮箱格式不正确' });
  }
  // 密码强度：与注册一致，至少 8 位且同时包含字母和数字
  if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return res.status(400).json({ error: '密码至少 8 位，且必须同时包含字母和数字' });
  }
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail)) return res.status(409).json({ error: '邮箱已存在' });
  const hash = await hashPassword(password);
  const info = db.prepare('INSERT INTO users (email, password_hash, name, is_admin, is_support) VALUES (?, ?, ?, ?, ?)').run(
    normalizedEmail, hash, name, is_admin ? 1 : 0, is_support ? 1 : 0
  );
  res.json({ ok: true, id: info.lastInsertRowid });
});

// ========== 使用日志 ==========
router.get('/logs', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = Math.min(100, Math.max(20, parseInt(req.query.size) || 50));
  const tool = (req.query.tool || '').toString();
  const status = (req.query.status || '').toString();
  const offset = (page - 1) * size;
  let where = 'WHERE 1=1';
  const params = [];
  if (tool) { where += ' AND tool_type = ?'; params.push(tool); }
  if (status) { where += ' AND status = ?'; params.push(status); }
  const total = db.prepare(`SELECT COUNT(*) as c FROM usage_logs ${where}`).get(...params).c;
  const logs = db.prepare(
    `SELECT * FROM usage_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...params, size, offset);
  res.json({ logs, total, page, size, pages: Math.ceil(total / size) });
});

// ========== 财务统计 ==========
router.get('/finance', (req, res) => {
  const todayTs = today();
  const range = (req.query.range || '30').toString();
  const days = Math.min(365, Math.max(1, parseInt(range, 10) || 30));
  const rangeStart = todayTs - (days - 1) * 86400;

  // ---- 1. 总览：各状态订单数 + 金额（整数分累加避免浮点误差）----
  const summary = db.prepare(
    `SELECT
      COALESCE(SUM(CASE WHEN status='paid' THEN ROUND(amount*100) ELSE 0 END), 0)/100.0 AS paid_amount,
      COUNT(CASE WHEN status='paid' THEN 1 END) AS paid_count,
      COALESCE(SUM(CASE WHEN status='pending' THEN ROUND(amount*100) ELSE 0 END), 0)/100.0 AS pending_amount,
      COUNT(CASE WHEN status='pending' THEN 1 END) AS pending_count,
      COUNT(CASE WHEN status='awaiting_quote' THEN 1 END) AS awaiting_quote_count,
      COUNT(CASE WHEN status='quoted' THEN 1 END) AS quoted_count,
      COUNT(CASE WHEN status='processing' THEN 1 END) AS processing_count,
      COUNT(CASE WHEN status='completed' THEN 1 END) AS completed_count,
      COUNT(CASE WHEN status='cancelled' THEN 1 END) AS cancelled_count
    FROM orders`
  ).get();

  // ---- 2. 多时段收入对比 ----
  const income = {
    today: db.prepare(`SELECT ${AMOUNT_SUM} AS s, COUNT(*) AS c FROM orders WHERE status='paid' AND paid_at >= ?`).get(todayTs),
    yesterday: db.prepare(`SELECT ${AMOUNT_SUM} AS s, COUNT(*) AS c FROM orders WHERE status='paid' AND paid_at >= ? AND paid_at < ?`).get(todayTs - 86400, todayTs),
    week: db.prepare(`SELECT ${AMOUNT_SUM} AS s, COUNT(*) AS c FROM orders WHERE status='paid' AND paid_at >= ?`).get(todayTs - 7 * 86400),
    month: db.prepare(`SELECT ${AMOUNT_SUM} AS s, COUNT(*) AS c FROM orders WHERE status='paid' AND paid_at >= ?`).get(todayTs - 30 * 86400),
    range: db.prepare(`SELECT ${AMOUNT_SUM} AS s, COUNT(*) AS c FROM orders WHERE status='paid' AND paid_at >= ?`).get(rangeStart),
    total: db.prepare(`SELECT ${AMOUNT_SUM} AS s, COUNT(*) AS c FROM orders WHERE status='paid'`).get(),
  };

  // ---- 3. 按业务类型拆分（功能 / 课程 / 毕业作品） ----
  const byType = db.prepare(
    `SELECT
      CASE
        WHEN type='course' THEN 'course'
        WHEN type='graduation' THEN 'graduation'
        ELSE 'feature'
      END AS biz_type,
      COUNT(*) AS count,
      COALESCE(SUM(ROUND(amount*100)), 0)/100.0 AS amount
    FROM orders WHERE status='paid' AND paid_at >= ?
    GROUP BY biz_type ORDER BY amount DESC`
  ).all(rangeStart);

  // ---- 4. 按支付通道拆分 ----
  const byChannel = db.prepare(
    `SELECT
      COALESCE(payment_channel, 'unknown') AS channel,
      COUNT(*) AS count,
      COALESCE(SUM(ROUND(amount*100)), 0)/100.0 AS amount
    FROM orders WHERE status='paid' AND paid_at >= ?
    GROUP BY channel ORDER BY amount DESC`
  ).all(rangeStart);

  // ---- 5. 每日收入趋势（指定天数） ----
  const trend = db.prepare(
    `SELECT
      strftime('%Y-%m-%d', paid_at, 'unixepoch', 'localtime') AS day,
      COUNT(*) AS orders,
      COALESCE(SUM(ROUND(amount*100)), 0)/100.0 AS amount
    FROM orders
    WHERE status='paid' AND paid_at >= ?
    GROUP BY day ORDER BY day ASC`
  ).all(rangeStart);

  // ---- 6. 近期已支付订单 ----
  const recentOrders = db.prepare(
    `SELECT o.order_no, o.type, o.target_name, o.amount, o.payment_channel, o.paid_at,
            u.email AS user_email, u.name AS user_name
     FROM orders o LEFT JOIN users u ON u.id = o.user_id
     WHERE o.status = 'paid'
     ORDER BY o.paid_at DESC LIMIT 20`
  ).all();

  // ---- 7. ARPPU（每付费用户平均收入） ----
  const payingUsers = db.prepare(
    "SELECT COUNT(DISTINCT user_id) AS c FROM orders WHERE status='paid' AND paid_at >= ?"
  ).get(rangeStart).c;
  const arppu = payingUsers > 0 ? (income.range.s / payingUsers) : 0;

  res.json({
    range: days,
    summary,
    income: {
      today: { amount: income.today.s, count: income.today.c },
      yesterday: { amount: income.yesterday.s, count: income.yesterday.c },
      week: { amount: income.week.s, count: income.week.c },
      month: { amount: income.month.s, count: income.month.c },
      range: { amount: income.range.s, count: income.range.c },
      total: { amount: income.total.s, count: income.total.c },
    },
    byType,
    byChannel,
    trend,
    recentOrders,
    arppu: Math.round(arppu * 100) / 100,
    payingUsers,
  });
});

// ========== 毕业作品指导管理 ==========
router.get('/graduation', (_req, res) => {
  const projects = db.prepare(
    'SELECT * FROM graduation_projects ORDER BY category, sort_order, id'
  ).all();
  res.json({ projects: projects.map((p) => ({ ...p, is_active: !!p.is_active })) });
});

router.post('/graduation', (req, res) => {
  const { id, title, category, description, base_price, duration_text, degree, is_active, sort_order } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: '请填写项目名称' });
  if (!category || !String(category).trim()) return res.status(400).json({ error: '请选择分类' });
  const price = Number(base_price) || 0;
  const deg = String(degree || '').trim() || null;
  const dur = String(duration_text || '').trim() || null;
  const active = is_active === false ? 0 : 1;
  const sort = Number(sort_order) || 0;

  if (id) {
    db.prepare(
      `UPDATE graduation_projects SET
         title = ?, category = ?, description = ?, base_price = ?, duration_text = ?,
         degree = ?, is_active = ?, sort_order = ?, updated_at = strftime('%s','now')
       WHERE id = ?`
    ).run(String(title).trim(), String(category).trim(), description || '', price, dur, deg, active, sort, id);
    return res.json({ ok: true, project: db.prepare('SELECT * FROM graduation_projects WHERE id = ?').get(id) });
  }
  const info = db.prepare(
    `INSERT INTO graduation_projects (title, category, description, base_price, duration_text, degree, is_active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(String(title).trim(), String(category).trim(), description || '', price, dur, deg, active, sort);
  res.json({ ok: true, project: db.prepare('SELECT * FROM graduation_projects WHERE id = ?').get(info.lastInsertRowid) });
});

router.delete('/graduation/:id', (req, res) => {
  db.prepare('DELETE FROM graduation_projects WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ========== 毕业作品订单管理 ==========
// 手动录入订单（线下成交补录 / 客服代录）：生成待对接订单供后续报价与跟进
router.post('/graduation-orders', (req, res) => {
  const { email, project_id, requirements, quoted_price, status, contact_status } = req.body || {};
  if (!email || !project_id) return res.status(400).json({ error: '请填写用户邮箱和项目' });
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
  if (!user) return res.status(404).json({ error: '用户不存在' });
  const project = db.prepare('SELECT * FROM graduation_projects WHERE id = ?').get(Number(project_id));
  if (!project) return res.status(404).json({ error: '项目不存在' });

  let requirementsJson = null;
  if (requirements != null) {
    requirementsJson = typeof requirements === 'string' ? requirements : JSON.stringify(requirements);
  }
  const price = quoted_price != null && quoted_price !== '' ? Number(quoted_price) : null;
  const st = ['pending', 'contacted', 'completed'].includes(status) ? status : 'pending';
  const cs = ['pending', 'contacted', 'completed'].includes(contact_status) ? contact_status : 'pending';

  const info = db.prepare(
    `INSERT INTO graduation_project_orders (user_id, project_id, requirements, quoted_price, status, contact_status)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(user.id, project.id, requirementsJson, price, st, cs);
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.get('/graduation-orders', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = Math.min(100, Math.max(10, parseInt(req.query.size) || 20));
  const status = (req.query.status || '').toString();
  const offset = (page - 1) * size;
  let where = 'WHERE 1=1';
  const params = [];
  if (['pending', 'contacted', 'completed'].includes(status)) {
    where += ' AND gpo.contact_status = ?';
    params.push(status);
  }
  const total = db.prepare(
    `SELECT COUNT(*) as c FROM graduation_project_orders gpo
     JOIN users u ON u.id = gpo.user_id
     JOIN graduation_projects gp ON gp.id = gpo.project_id ${where}`
  ).get(...params).c;
  const rows = db.prepare(
    `SELECT gpo.id, gpo.status, gpo.contact_status, gpo.quote_status, gpo.quoted_price, gpo.purchased_at, gpo.expires_at, gpo.requirements,
            u.name AS user_name, u.email AS user_email,
            gp.title AS project_title, gp.category,
            o.order_no, o.amount
     FROM graduation_project_orders gpo
     JOIN users u ON u.id = gpo.user_id
     JOIN graduation_projects gp ON gp.id = gpo.project_id
     LEFT JOIN orders o ON o.id = gpo.order_id
     ${where}
     ORDER BY gpo.id DESC LIMIT ? OFFSET ?`
  ).all(...params, size, offset);
  const items = rows.map((r) => {
    let requirements = null;
    try { requirements = r.requirements ? JSON.parse(r.requirements) : null; } catch { requirements = null; }
    return { ...r, requirements };
  });
  res.json({ items, total, page, size, pages: Math.ceil(total / size) });
});

router.put('/graduation-orders/:id/contact-status', (req, res) => {
  const { status } = req.body || {};
  if (!['pending', 'contacted', 'completed'].includes(status)) return res.status(400).json({ error: '无效的对接状态' });
  const row = db.prepare('SELECT id FROM graduation_project_orders WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '订单不存在' });
  db.prepare('UPDATE graduation_project_orders SET contact_status = ? WHERE id = ?').run(status, row.id);
  res.json({ ok: true, id: row.id, contact_status: status });
});

router.put('/graduation-orders/:id/quote', (req, res) => {
  const { quoted_price } = req.body || {};
  const price = Number(quoted_price);
  if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: '报价金额无效' });
  // 金额上限：防止超大数值进入 orders.amount 破坏财务统计与浮点计算
  if (price > 1000000) return res.status(400).json({ error: '报价金额超出上限（100万元）' });
  const row = db.prepare('SELECT id FROM graduation_project_orders WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '订单不存在' });
  // 管理员报价直接生效（管理员具备审批权限，无需再走审批）
  db.prepare('UPDATE graduation_project_orders SET quoted_price = ?, quote_status = ? WHERE id = ?')
    .run(price, 'approved', row.id);
  // 报价变更：作废用户已创建的待支付订单，防止按旧价成交
  closePendingGraduationOrders(row.id);
  res.json({ ok: true, id: row.id, quoted_price: price, quote_status: 'approved' });
});

// 报价审批：管理员通过/驳回客服提交的报价
router.put('/graduation-orders/:id/quote-status', (req, res) => {
  const { status } = req.body || {};
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: '无效的审批操作' });
  const row = db.prepare('SELECT id, quote_status, quoted_price FROM graduation_project_orders WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '订单不存在' });
  if (status === 'approved' && (row.quoted_price == null || row.quoted_price <= 0)) {
    return res.status(400).json({ error: '无有效报价，无法通过审批' });
  }
  db.prepare('UPDATE graduation_project_orders SET quote_status = ? WHERE id = ?').run(status, row.id);
  // 审批状态变化（通过/驳回）：作废用户已创建的待支付订单，防止按旧价成交
  closePendingGraduationOrders(row.id);
  res.json({ ok: true, id: row.id, quote_status: status });
});

export default router;

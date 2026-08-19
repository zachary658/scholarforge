import db from './db.js';
import { MODEL_CATALOG, getModelPreset, getModelKeyFromEnv } from './model-catalog.js';

// 读取单个设置
export function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

// 读取全部设置（脱敏）
export function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  return obj;
}

// 写入设置
export function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%s','now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, String(value));
  invalidateSiteCache();
}

// 注册赠送积分配置
export function getSignupPointsConfig() {
  return {
    points: parseInt(getSetting('signup_points', '30'), 10) || 30,
  };
}

// 注册风控配置（防批量注册白嫖赠送积分）
export function getSignupGuardConfig() {
  return {
    // 同一 IP 在 24 小时内最多注册的账号数（0 = 不限制）
    ipLimit: parseInt(getSetting('signup_ip_limit', '3'), 10) || 0,
    // 同一设备指纹最多注册的账号数（0 = 不限制）
    deviceLimit: parseInt(getSetting('signup_device_limit', '1'), 10) || 0,
  };
}

// 一次性/临时邮箱域名黑名单（防用临时邮箱批量注册）
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com', 'mailinator.net', '10minutemail.com', '10minutemail.net',
  'temp-mail.org', 'tempmail.com', 'temp-mail.ru', 'guerrillamail.com',
  'guerrillamail.net', 'sharklasers.com', 'grr.la', 'pokemail.net',
  'spam4.me', 'throwawaymail.com', 'maildrop.cc', 'getnada.com',
  'nada.email', 'nada.ltd', 'dispostable.com', 'yopmail.com',
  'yopmail.fr', 'yopmail.net', 'mintemail.com', 'emailondeck.com',
  'getairmail.com', 'mailnesia.com', 'trashmail.com', 'trashmail.net',
  'mytrashmail.com', 'tempinbox.com', 'mailcatch.com', 'chacuo.net',
  'moakt.com', 'mohmal.com', 'mail.tm', 'mail.gw', 'tempmail.dev',
]);

// 判断邮箱是否属于一次性/临时邮箱域名
export function isDisposableEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return false;
  const domain = email.slice(at + 1).toLowerCase().trim();
  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

// AI 计费配置（按大模型 token 用量计费，保证利润率）
// 返回成本单价（元/百万 token）、目标利润率、积分换算比例
export function getAiPricingConfig() {
  return {
    // 大模型 API 成本：输入/输出单价（元/百万 token）
    inputCostPerMillion: parseFloat(getSetting('ai_input_cost_per_million', '1')) || 1,
    outputCostPerMillion: parseFloat(getSetting('ai_output_cost_per_million', '16')) || 16,
    // 目标利润率（0.8 = 80%）：售价 = 成本 / (1 - 利润率)
    profitMargin: Math.min(parseFloat(getSetting('ai_profit_margin', '0.8')) || 0.8, 0.99),
    // 积分换算：1 元 = 10 积分
    pointsPerYuan: 10,
  };
}

// 兼容旧接口
export function getSignupQuotaConfig() {
  return {
    quota: parseInt(getSetting('signup_free_quota', '3'), 10) || 0,
    validityDays: parseInt(getSetting('signup_free_quota_validity_days', '30'), 10) || 30,
  };
}

// 支付配置（带内存缓存，TTL 60 秒，避免高频 DB 查询）
const PAYMENT_CACHE_TTL = 60 * 1000; // 60 秒
let _paymentCache = null;
let _paymentCacheAt = 0;

export function getPaymentConfig() {
  const now = Date.now();
  if (_paymentCache && (now - _paymentCacheAt) < PAYMENT_CACHE_TTL) {
    return _paymentCache;
  }
  _paymentCache = {
    mode: getSetting('payment_mode', 'mock'), // mock / alipay / wechat / mixed
    orderExpireSeconds: parseInt(getSetting('order_expire_seconds', '900'), 10) || 900,
    docRetentionDays: parseInt(getSetting('doc_retention_days', '30'), 10) || 30,
    alipay: {
      appid: getSetting('alipay_appid', ''),
      privateKey: getSetting('alipay_private_key', ''),
      publicKey: getSetting('alipay_public_key', ''),
      gateway: getSetting('alipay_gateway', 'https://openapi.alipay.com/gateway.do'),
      sandbox: getSetting('alipay_sandbox', 'false') === 'true',
    },
    wechat: {
      appid: getSetting('wechat_appid', ''),
      mchId: getSetting('wechat_mch_id', ''),
      apiV3Key: getSetting('wechat_api_v3_key', ''),
      serialNo: getSetting('wechat_serial_no', ''),
      privateKey: getSetting('wechat_private_key', ''),
      notifyUrl: getSetting('wechat_notify_url', ''),
      platformPublicKey: getSetting('wechat_platform_public_key', ''),
      platformSerialNo: getSetting('wechat_platform_serial_no', ''),
    },
  };
  _paymentCacheAt = now;
  return _paymentCache;
}

// 支付配置缓存失效（管理员修改支付设置后调用）
export function invalidatePaymentCache() {
  _paymentCache = null;
  _paymentCacheAt = 0;
}

// 判断某通道是否已配置（用于前端展示「可用通道」）
// 安全：mock 通道仅限非生产环境（且未配置真实通道或显式 mock 模式）时暴露；
// 生产环境永不返回 mock，避免默认 payment_mode=mock 时被用于零成本绕过支付
export function getAvailableChannels() {
  const cfg = getPaymentConfig();
  const channels = [];
  if (cfg.alipay.appid && cfg.alipay.privateKey && cfg.alipay.publicKey) channels.push('alipay');
  if (cfg.wechat.appid && cfg.wechat.mchId && cfg.wechat.apiV3Key && cfg.wechat.privateKey) channels.push('wechat');
  if (process.env.NODE_ENV !== 'production' && (channels.length === 0 || cfg.mode === 'mock')) channels.push('mock');
  return channels;
}

// 功能定价
export function getFeaturePrices({ onlyActive = false } = {}) {
  const sql = onlyActive
    ? 'SELECT * FROM feature_prices WHERE is_active = 1 ORDER BY sort_order ASC'
    : 'SELECT * FROM feature_prices ORDER BY sort_order ASC';
  return db.prepare(sql).all().map((p) => ({
    ...p,
    is_active: !!p.is_active,
    is_unlimited: !!p.is_unlimited,
  }));
}

export function getFeaturePrice(featureKey) {
  const row = db.prepare('SELECT * FROM feature_prices WHERE feature_key = ?').get(featureKey);
  if (!row) return null;
  return { ...row, is_active: !!row.is_active, is_unlimited: !!row.is_unlimited };
}

// 积分充值套餐
export function getPointsPackages({ onlyActive = false } = {}) {
  const sql = onlyActive
    ? 'SELECT * FROM points_packages WHERE is_active = 1 ORDER BY sort_order ASC'
    : 'SELECT * FROM points_packages ORDER BY sort_order ASC';
  return db.prepare(sql).all().map((p) => ({ ...p, is_active: !!p.is_active }));
}

export function getPointsPackage(id) {
  const row = db.prepare('SELECT * FROM points_packages WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, is_active: !!row.is_active };
}

// 课程（论文 1 对 1 指导等服务型商品）
export function getCourses({ onlyActive = false } = {}) {
  const sql = onlyActive
    ? 'SELECT * FROM courses WHERE is_active = 1 ORDER BY sort_order ASC, id ASC'
    : 'SELECT * FROM courses ORDER BY sort_order ASC, id ASC';
  return db.prepare(sql).all().map((c) => ({ ...c, is_active: !!c.is_active }));
}

export function getCourse(id) {
  const row = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, is_active: !!row.is_active };
}

// 课程定制报价规则（论文 1 对 1 指导）：基础价来自课程"起"价，需求项累加
// course 参数可选：传入课程时，其 custom_* 字段覆盖全局默认值（NULL=使用全局值）
export function getCourseQuoteConfig(course = null) {
  const global = {
    baseWordCount: parseInt(getSetting('course_quote_base_word_count', '10000'), 10) || 10000,
    wordPrice: parseFloat(getSetting('course_quote_word_price', '500')) || 0,
    chartPrice: parseFloat(getSetting('course_quote_chart_price', '100')) || 0,
    drawingPrice: parseFloat(getSetting('course_quote_drawing_price', '150')) || 0,
    formulaLow: parseFloat(getSetting('course_quote_formula_low', '200')) || 0,
    formulaMid: parseFloat(getSetting('course_quote_formula_mid', '500')) || 0,
    formulaHigh: parseFloat(getSetting('course_quote_formula_high', '1000')) || 0,
    urgentMultiplier: Math.max(1, parseFloat(getSetting('course_quote_urgent_multiplier', '1.3')) || 1),
  };
  if (!course) return global;
  return {
    baseWordCount: course.custom_base_word_count != null ? course.custom_base_word_count : global.baseWordCount,
    wordPrice: course.custom_word_price != null ? course.custom_word_price : global.wordPrice,
    chartPrice: course.custom_chart_price != null ? course.custom_chart_price : global.chartPrice,
    drawingPrice: course.custom_drawing_price != null ? course.custom_drawing_price : global.drawingPrice,
    formulaLow: course.custom_formula_low != null ? course.custom_formula_low : global.formulaLow,
    formulaMid: course.custom_formula_mid != null ? course.custom_formula_mid : global.formulaMid,
    formulaHigh: course.custom_formula_high != null ? course.custom_formula_high : global.formulaHigh,
    urgentMultiplier: course.custom_urgent_multiplier != null
      ? Math.max(1, course.custom_urgent_multiplier)
      : global.urgentMultiplier,
  };
}

// 默认 AI 模型（预设目录 + 环境变量 Key，Key 不落库）
// 返回结构与旧 ai_models 记录一致，兼容 ai-service / paper-distillation / has_real_ai 判断
export function getDefaultModel() {
  const defaultKey = getSetting('ai_default_model', '');
  const preset = defaultKey ? getModelPreset(defaultKey) : null;
  if (!preset) return null;
  const apiKey = getModelKeyFromEnv(preset);
  if (!apiKey) return null;
  return {
    id: null,
    key: preset.key,
    name: preset.name,
    provider: preset.provider,
    base_url: preset.base_url,
    api_key: apiKey,
    model_name: preset.model_name,
    temperature: preset.temperature ?? 0.7,
    max_tokens: preset.max_tokens || 2048,
    is_default: 1,
    is_active: 1,
  };
}

// 预设模型状态列表（供管理后台「选择模型」展示；不含 Key 明文，仅返回是否已配置）
export function getModels() {
  const defaultKey = getSetting('ai_default_model', '');
  return MODEL_CATALOG.map((m) => {
    const keyConfigured = !!getModelKeyFromEnv(m);
    return {
      id: m.key,
      key: m.key,
      name: m.name,
      provider: m.provider,
      base_url: m.base_url,
      model_name: m.model_name,
      temperature: m.temperature ?? 0.7,
      max_tokens: m.max_tokens || 2048,
      env_key: m.env_key,
      api_key_configured: keyConfigured,
      api_key_masked: keyConfigured ? `已通过 ${m.env_key} 环境变量配置` : `未配置（需设置 ${m.env_key}）`,
      is_default: defaultKey === m.key ? 1 : 0,
      is_active: 1,
    };
  });
}

// 公开站点信息（不含敏感项）
// 缓存 TTL 60s：避免每次 /api/public/site 高频查询多张表；setSetting 时失效
const SITE_CACHE_TTL = 60 * 1000;
let _siteCache = null;
let _siteCacheAt = 0;

export function getPublicSiteInfo() {
  const now = Date.now();
  if (_siteCache && (now - _siteCacheAt) < SITE_CACHE_TTL) return _siteCache;
  const packages = getPointsPackages({ onlyActive: true });
  const channels = getAvailableChannels();
  // getDefaultModel 只查一次（原先调用两次，多一次 DB 查询）
  const defaultModel = getDefaultModel();
  const aiPricing = getAiPricingConfig();
  _siteCache = {
    site_name: getSetting('site_name', 'ScholarForge'),
    site_description: getSetting('site_description', ''),
    announcement: getSetting('announcement', ''),
    service_wechat: getSetting('service_wechat', ''),
    service_wechat_qrcode: getSetting('service_wechat_qrcode', ''),
    registration_open: getSetting('registration_open', 'true') === 'true',
    footer_text: getSetting('footer_text', ''),
    signup_points: getSignupPointsConfig().points,
    points_packages: packages,
    payment_channels: channels,
    // 课程（论文 1 对 1 指导）：公开展示，用户添加客服微信详聊购买
    courses: getCourses({ onlyActive: true }),
    has_real_ai: !!(defaultModel && defaultModel.provider !== 'builtin'),
    preset_templates_count: db.prepare('SELECT COUNT(*) as c FROM templates WHERE is_preset = 1').get().c,
    // 计费说明：按大模型用量计费，1元=10积分
    ai_pricing: {
      points_per_yuan: aiPricing.pointsPerYuan,
      profit_margin: aiPricing.profitMargin,
    },
  };
  _siteCacheAt = now;
  return _siteCache;
}

// 站点信息缓存失效（管理端修改站点/课程/套餐/模型后调用）
export function invalidateSiteCache() {
  _siteCache = null;
  _siteCacheAt = 0;
}

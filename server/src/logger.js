/**
 * 结构化日志工具
 * 统一日志格式，包含时间戳、级别、模块名，便于生产环境排查
 * 生产环境（或 LOG_TO_FILE=true）额外按天落盘到 logs/ 目录
 */
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = process.env.LOG_DIR || join(__dirname, '..', 'logs');
const shouldWriteFile = process.env.LOG_TO_FILE === 'true' || process.env.NODE_ENV === 'production';

// 异步写盘队列：内存缓冲 + 1s 定时 flush + 200 条高水位直接刷盘。
// 此前每条日志同步 existsSync + appendFileSync，生产环境高频日志会反复阻塞事件循环。
const pendingLines = [];
let flushTimer = null;
let flushing = false;

function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch { /* 忽略目录创建失败 */ }
}

function flushPending() {
  if (flushing || pendingLines.length === 0) return;
  flushing = true;
  const batch = pendingLines.splice(0, pendingLines.length);
  const dateStr = new Date().toISOString().slice(0, 10);
  ensureLogDir();
  fs.appendFile(join(LOG_DIR, `scholarforge-${dateStr}.log`), batch.join('\n') + '\n', 'utf8', () => {
    flushing = false;
    if (pendingLines.length > 0) flushPending();
  });
}

function writeToFile(line) {
  if (!shouldWriteFile) return;
  pendingLines.push(line);
  if (pendingLines.length >= 200) {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    flushPending();
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => { flushTimer = null; flushPending(); }, 1000);
    flushTimer.unref?.();
  }
}

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const alertWebhookUrl = String(process.env.ALERT_WEBHOOK_URL || '').trim();
const alertTimeoutMs = Math.min(10000, Math.max(1000, Number(process.env.ALERT_WEBHOOK_TIMEOUT_MS) || 4000));
const alertCooldownMs = Math.min(3600000, Math.max(1000, Number(process.env.ALERT_WEBHOOK_COOLDOWN_MS) || 60000));
const recentAlerts = new Map();
let alertDeliveryActive = false;

function shouldLog(level) {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatLog(level, module, message, data) {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] [${module}] ${message}`;
  if (data !== undefined) {
    try {
      const str = typeof data === 'string' ? data : JSON.stringify(data, null, 0);
      return `${base} ${str}`;
    } catch {
      return `${base} [unserializable]`;
    }
  }
  return base;
}

function alertFingerprint(module, message) {
  const normalized = `${module}:${String(message).replace(/\d+/g, '#').slice(0, 300)}`;
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}

// 非阻塞错误告警：失败只写 console，不递归调用 logger，也不影响业务响应。
// 通用 JSON 载荷可接入自建网关、Sentry bridge 或任意告警 webhook。
export async function deliverErrorAlert(module, message, data) {
  if (!alertWebhookUrl || alertDeliveryActive) return false;
  const fingerprint = alertFingerprint(module, message);
  const timestamp = Date.now();
  if (timestamp - (recentAlerts.get(fingerprint) || 0) < alertCooldownMs) return false;
  recentAlerts.set(fingerprint, timestamp);
  if (recentAlerts.size > 500) {
    for (const [key, seenAt] of recentAlerts) if (timestamp - seenAt > alertCooldownMs * 2) recentAlerts.delete(key);
  }
  alertDeliveryActive = true;
  try {
    const response = await fetch(alertWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event: 'scholarforge.server_error',
        environment: process.env.NODE_ENV || 'development',
        version: process.env.APP_VERSION || 'unknown',
        timestamp: new Date(timestamp).toISOString(),
        level: 'error',
        module,
        message: redact(message),
        data: redact(data),
        fingerprint,
      }),
      signal: AbortSignal.timeout(alertTimeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
  } catch (err) {
    console.warn(`[alert-webhook] delivery failed: ${err.message}`);
    return false;
  } finally {
    alertDeliveryActive = false;
  }
}

// 敏感字段脱敏：日志可能包含 token / 邮箱 / 手机号 / 密码 / API Key / Cookie 等，
// 在输出或落盘前统一掩码，避免凭据泄露到日志文件（L-2 加固）。
const SENSITIVE_KEY_RE = /(token|secret|password|passwd|authorization|api[_-]?key|cookie|phone|mobile|id[_-]?card|email|mail)/i;
export function redact(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    // JWT / Bearer 令牌
    if (/^Bearer\s+/i.test(value) || /\b[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/.test(value)) {
      return '***redacted***';
    }
    // 邮箱和大陆手机号（包括嵌入在错误消息中的联系方式）
    return value
      .replace(/([\w.+-]{1,3})[\w.+-]*(@[\w.-]+\.\w+)/g, '$1***$2')
      .replace(/\b(1\d{2})\d{4}(\d{4})\b/g, '$1****$2');
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY_RE.test(k) && v ? '***redacted***' : redact(v, seen);
    }
    return out;
  }
  return value;
}

function emit(level, fn, module, message, data) {
  if (!shouldLog(level)) return;
  const safeMessage = typeof message === 'string' ? redact(message) : message;
  const safeData = data !== undefined ? redact(data) : undefined;
  const line = formatLog(level, module, safeMessage, safeData);
  fn(line);
  writeToFile(line);
  if (level === 'error') void deliverErrorAlert(module, safeMessage, safeData);
}

const logger = {
  debug(module, message, data) {
    emit('debug', console.debug, module, message, data);
  },
  info(module, message, data) {
    emit('info', console.info, module, message, data);
  },
  warn(module, message, data) {
    emit('warn', console.warn, module, message, data);
  },
  error(module, message, data) {
    emit('error', console.error, module, message, data);
  },
};

export default logger;

/**
 * 结构化日志工具
 * 统一日志格式，包含时间戳、级别、模块名，便于生产环境排查
 * 生产环境（或 LOG_TO_FILE=true）额外按天落盘到 logs/ 目录
 */
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = process.env.LOG_DIR || join(__dirname, '..', 'logs');
const shouldWriteFile = process.env.LOG_TO_FILE === 'true' || process.env.NODE_ENV === 'production';

function writeToFile(line) {
  if (!shouldWriteFile) return;
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const dateStr = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(join(LOG_DIR, `scholarforge-${dateStr}.log`), line + '\n');
  } catch {
    /* 忽略文件写入失败，避免影响主流程 */
  }
}

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

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

function emit(level, fn, module, message, data) {
  if (!shouldLog(level)) return;
  const line = formatLog(level, module, message, data);
  fn(line);
  writeToFile(line);
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
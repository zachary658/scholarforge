import fs from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';
import logger from '../logger.js';
import { backupDatabase } from './backup.js';

const DEFAULT_DIR = fileURLToPath(new URL('../../backups/', import.meta.url));

function backupFileName(date = new Date()) {
  return `scholarforge-${date.toISOString().replace(/[-:T]/g, '').slice(0, 14)}.db`;
}

export async function runScheduledBackup({
  outputDir = process.env.BACKUP_DIR || DEFAULT_DIR,
  retentionDays = Number(process.env.BACKUP_RETENTION_DAYS) || 14,
  date = new Date(),
} = {}) {
  const dir = resolve(outputDir);
  const destination = join(dir, backupFileName(date));
  await backupDatabase(db, destination);
  const cutoff = date.getTime() - Math.max(1, retentionDays) * 86400000;
  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !/^scholarforge-\d{14}\.db$/.test(entry.name)) continue;
    const path = join(dir, entry.name);
    if (fs.statSync(path).mtimeMs < cutoff) { fs.unlinkSync(path); removed += 1; }
  }
  logger.info('backup', `database backup completed: ${destination}`, { removed, retentionDays });
  return { destination, removed };
}

export function startBackupScheduler({
  enabled = process.env.BACKUP_ENABLED || (process.env.NODE_ENV === 'production' ? 'true' : 'false'),
  intervalHours = process.env.BACKUP_INTERVAL_HOURS,
  runBackup = runScheduledBackup,
  setTimeoutFn = setTimeout,
  setIntervalFn = setInterval,
  clearTimeoutFn = clearTimeout,
  clearIntervalFn = clearInterval,
} = {}) {
  if (String(enabled).toLowerCase() !== 'true') {
    return null;
  }
  const hours = Math.min(168, Math.max(1, Number(intervalHours) || 24));
  const run = async () => {
    try { await runBackup(); return true; }
    catch (err) { logger.error('backup', 'scheduled backup failed', { error: err.message }); return false; }
  };
  const initialTimer = setTimeoutFn(run, 30000);
  initialTimer.unref?.();
  const interval = setIntervalFn(run, hours * 3600000);
  interval.unref?.();
  logger.info('backup', `automatic backup enabled (every ${hours}h)`);
  return {
    initialTimer,
    interval,
    runNow: run,
    stop() { clearTimeoutFn(initialTimer); clearIntervalFn(interval); },
  };
}

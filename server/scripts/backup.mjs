#!/usr/bin/env node
// 数据库在线备份脚本（P1-8）
// 用法：node scripts/backup.mjs [输出目录]
// 默认输出到 server/data/backups/scholarforge-<时间戳>.db，可被恢复脚本/人工直接使用。
// 恢复说明：停止服务后，用备份文件覆盖 data/scholarforge.db（连同删除 -wal/-shm），
// 或在新实例上设置 DB_PATH 指向备份文件即可恢复。
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import db from '../src/db.js';
import { backupDatabase } from '../src/services/backup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] || join(__dirname, '..', 'data', 'backups');
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const dest = join(outDir, `scholarforge-${stamp}.db`);

try {
  await backupDatabase(db, dest);
  console.log(`备份成功：${dest}`);
} catch (err) {
  console.error(`备份失败：${err.message}`);
  process.exit(1);
}

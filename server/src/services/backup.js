// 数据库在线备份（P1-8）
// 使用 better-sqlite3 自带的 backup API：在 WAL 模式下也能得到一致、可恢复的完整快照，
// 无需停服，也不会因只复制主 .db 文件而丢失 -wal 中的未 checkpoint 数据。
import fs from 'fs';
import { dirname } from 'path';

// 备份到 destPath（绝对路径），返回备份文件路径。备份失败抛错，由调用方决定如何处理。
export async function backupDatabase(db, destPath) {
  fs.mkdirSync(dirname(destPath), { recursive: true });
  await db.backup(destPath);
  return destPath;
}

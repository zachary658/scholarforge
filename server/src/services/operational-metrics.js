import db from '../db.js';
import { now } from '../utils.js';

function bucketHour(timestamp = now()) {
  return Math.floor(timestamp / 3600) * 3600;
}

export function recordOperationalMetric(metric, dimension = '', value = 0) {
  const safeMetric = String(metric || '').trim().slice(0, 80);
  const safeDimension = String(dimension || '').trim().slice(0, 120);
  if (!safeMetric) return;
  db.prepare(
    `INSERT INTO operational_metrics (bucket_hour, metric, dimension, count, total_value)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(bucket_hour, metric, dimension) DO UPDATE SET
       count=count+1, total_value=total_value+excluded.total_value, updated_at=strftime('%s','now')`
  ).run(bucketHour(), safeMetric, safeDimension, Number.isFinite(Number(value)) ? Number(value) : 0);
}

export function getOperationalMetrics(hours = 24) {
  const safeHours = Math.max(1, Math.min(24 * 30, Number(hours) || 24));
  const since = bucketHour(now() - safeHours * 3600);
  const rows = db.prepare(
    `SELECT metric, dimension, SUM(count) AS count, SUM(total_value) AS total_value,
            MIN(bucket_hour) AS from_hour, MAX(bucket_hour) AS to_hour
     FROM operational_metrics WHERE bucket_hour >= ?
     GROUP BY metric, dimension ORDER BY metric, count DESC`
  ).all(since);
  return { hours: safeHours, rows };
}

export function cleanupOperationalMetrics(retentionDays = 90) {
  return db.prepare('DELETE FROM operational_metrics WHERE bucket_hour < ?')
    .run(bucketHour(now() - Math.max(7, retentionDays) * 86400)).changes;
}

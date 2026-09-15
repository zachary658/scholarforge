import db from '../db.js';
import { now } from '../utils.js';

const DEFAULT_STAGES = [
  ['需求确认与排期', 10, '确认服务范围、交付物与时间安排'],
  ['方案与初稿', 20, '提交方案、结构或第一阶段成果'],
  ['中期成果', 30, '提交主要工作成果并进入修改阶段'],
  ['最终交付', 40, '完成验收版本并解锁最终成果下载'],
];

export function ensureDefaultMilestones(serviceProjectId, totalYuan) {
  const project = db.prepare('SELECT id FROM service_projects WHERE id=?').get(serviceProjectId);
  if (!project) throw Object.assign(new Error('服务项目不存在'), { status: 404 });
  const existing = db.prepare('SELECT * FROM service_payment_milestones WHERE service_project_id=? ORDER BY sequence').all(serviceProjectId);
  const totalCents = Math.round(Number(totalYuan) * 100);
  if (!Number.isInteger(totalCents) || totalCents < 100) throw Object.assign(new Error('报价金额无效'), { status: 400 });
  if (existing.length) {
    const existingTotal = existing.reduce((sum, item) => sum + item.amount_cents, 0);
    if (existingTotal === totalCents) return existing;
    if (existing.some((item) => item.status === 'paid')) throw Object.assign(new Error('已有阶段完成付款，不能修改总报价'), { status: 409 });
    db.prepare('DELETE FROM service_payment_milestones WHERE service_project_id=?').run(serviceProjectId);
  }
  const insert = db.prepare(`INSERT INTO service_payment_milestones
    (service_project_id,sequence,title,description,amount_cents) VALUES (?,?,?,?,?)`);
  const create = db.transaction(() => {
    let allocated = 0;
    DEFAULT_STAGES.forEach(([title, percent, description], index) => {
      const cents = index === DEFAULT_STAGES.length - 1
        ? totalCents - allocated
        : Math.round(totalCents * percent / 100);
      allocated += cents;
      insert.run(serviceProjectId, index + 1, title, description, cents);
    });
  });
  create();
  return listMilestones(serviceProjectId);
}

export function listMilestones(serviceProjectId) {
  return db.prepare(`SELECT m.id,m.sequence,m.title,m.description,m.amount_cents,m.status,m.paid_at,
      o.order_no,o.payment_channel,o.expires_at
    FROM service_payment_milestones m LEFT JOIN orders o ON o.id=m.order_id
    WHERE m.service_project_id=? ORDER BY m.sequence`).all(serviceProjectId);
}

export function summarizeMilestones(serviceProjectId) {
  const milestones = listMilestones(serviceProjectId);
  const paid = milestones.filter((item) => item.status === 'paid');
  return {
    milestones,
    total_cents: milestones.reduce((sum, item) => sum + item.amount_cents, 0),
    paid_cents: paid.reduce((sum, item) => sum + item.amount_cents, 0),
    all_paid: milestones.length > 0 && paid.length === milestones.length,
    any_paid: paid.length > 0,
    next: milestones.find((item) => item.status !== 'paid' && item.status !== 'cancelled') || null,
  };
}

export function markMilestonePaid(milestoneId, orderId, paidAt = now()) {
  const milestone = db.prepare('SELECT * FROM service_payment_milestones WHERE id=?').get(milestoneId);
  if (!milestone || milestone.order_id !== orderId) throw new Error('阶段付款单归属异常');
  if (milestone.status === 'paid') return summarizeMilestones(milestone.service_project_id);
  if (milestone.status !== 'payment_pending') throw new Error('阶段付款状态已变化');
  db.prepare("UPDATE service_payment_milestones SET status='paid',paid_at=?,updated_at=? WHERE id=?").run(paidAt, paidAt, milestone.id);
  return summarizeMilestones(milestone.service_project_id);
}


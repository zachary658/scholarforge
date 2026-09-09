import db from '../db.js';
import { now } from '../utils.js';

const count = (sql, ...params) => Number(db.prepare(sql).get(...params)?.count || 0);
const money = (sql, ...params) => Number(db.prepare(sql).get(...params)?.cents || 0);
const rate = (value, base) => base > 0 ? Number((value / base * 100).toFixed(1)) : 0;

export function getCommercialOverview(days = 30) {
  const safeDays = Math.max(1, Math.min(365, Number(days) || 30));
  const since = now() - safeDays * 86400;
  const registered = count("SELECT COUNT(*) count FROM users WHERE is_admin=0 AND is_support=0 AND created_at>=?", since);
  const verified = count("SELECT COUNT(*) count FROM users WHERE is_admin=0 AND is_support=0 AND created_at>=? AND email_verified_at IS NOT NULL", since);
  const projectUsers = count('SELECT COUNT(DISTINCT user_id) count FROM projects WHERE created_at>=?', since);
  const orderUsers = count('SELECT COUNT(DISTINCT user_id) count FROM orders WHERE created_at>=?', since);
  const paidUsers = count("SELECT COUNT(DISTINCT user_id) count FROM orders WHERE paid_at>=? AND status IN ('paid','processing','completed')", since);
  const paidOrders = count("SELECT COUNT(*) count FROM orders WHERE paid_at>=? AND status IN ('paid','processing','completed')", since);
  const completedOrders = count("SELECT COUNT(*) count FROM orders WHERE paid_at>=? AND status='completed'", since);
  const expertLeads = count('SELECT COUNT(*) count FROM service_projects WHERE created_at>=?', since);
  const revenueCents = money("SELECT COALESCE(SUM(ROUND(amount*100)),0) cents FROM orders WHERE paid_at>=? AND status IN ('paid','processing','completed')", since);
  const humanCostCents = money('SELECT COALESCE(SUM(internal_cost_cents),0) cents FROM service_projects WHERE created_at>=?', since);
  const commissionCents = money(
    `SELECT COALESCE(SUM(ROUND(o.amount*100) * pp.commission_bps / 10000.0),0) cents
     FROM service_projects sp JOIN orders o ON o.id=sp.order_id
     JOIN promotion_codes pc ON pc.id=sp.promotion_code_id JOIN promotion_partners pp ON pp.id=pc.partner_id
     WHERE o.paid_at>=? AND o.status IN ('paid','processing','completed')`, since,
  );
  const pendingAfterSales = count("SELECT COUNT(*) count FROM after_sales_requests WHERE status IN ('pending','approved')");
  const contributionCents = Math.round(revenueCents - humanCostCents - commissionCents);
  const funnel = [
    { key: 'registered', label: '注册用户', count: registered, conversion: 100 },
    { key: 'verified', label: '邮箱验证', count: verified, conversion: rate(verified, registered) },
    { key: 'project', label: '创建项目', count: projectUsers, conversion: rate(projectUsers, registered) },
    { key: 'ordered', label: '创建订单', count: orderUsers, conversion: rate(orderUsers, projectUsers) },
    { key: 'paid', label: '付费用户', count: paidUsers, conversion: rate(paidUsers, orderUsers) },
    { key: 'completed', label: '完成订单', count: completedOrders, conversion: rate(completedOrders, paidOrders) },
  ];
  const events = db.prepare(
    `SELECT event_name, COUNT(*) count, COALESCE(SUM(value_cents),0) value_cents
     FROM business_events WHERE created_at>=? GROUP BY event_name ORDER BY count DESC`
  ).all(since);
  return {
    days: safeDays,
    funnel,
    totals: {
      paid_orders: paidOrders,
      expert_leads: expertLeads,
      pending_after_sales: pendingAfterSales,
      revenue_cents: revenueCents,
      human_cost_cents: humanCostCents,
      commission_cents: Math.round(commissionCents),
      contribution_cents: contributionCents,
      contribution_margin: revenueCents > 0 ? Number((contributionCents / revenueCents * 100).toFixed(1)) : 0,
    },
    events,
    caveat: '漏斗为时间窗内事件用户数，参考比率不是严格同批用户转化率；贡献利润暂未包含支付手续费、服务器、税费和无法归集到订单的模型调用成本。',
  };
}

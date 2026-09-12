import db from '../db.js';
import { now } from '../utils.js';
import { getAiPricingConfig } from '../config-store.js';

const degreeLabels = { undergraduate: '本科', master: '硕士', doctorate: '博士', other: '其他' };
const parseObject = (text) => { try { return JSON.parse(text || '{}') || {}; } catch { return {}; } };
const rounded = (value) => Number(value.toFixed(4));

// Use purchase-time degree snapshots so editing a project cannot rewrite historical revenue.
function degreeTier(order) {
  const value = parseObject(order.metadata).pricing?.tierKey
    || parseObject(order.params_json).degree_tier || parseObject(order.metadata).degree || order.degree;
  if (Object.hasOwn(degreeLabels, value)) return value;
  if (/博士/.test(value)) return 'doctorate';
  if (/硕士/.test(value)) return 'master';
  if (/本科/.test(value)) return 'undergraduate';
  return 'other';
}

function getDegreeOverview(since) {
  const orders = db.prepare(`SELECT o.*, p.degree FROM orders o
    LEFT JOIN projects p ON p.id=o.project_id AND p.user_id=o.user_id
    WHERE o.paid_at>=? AND o.status IN ('paid','processing','completed')`).all(since);
  const pricing = getAiPricingConfig();
  const groups = Object.entries(degreeLabels).map(([degree, label]) => ({
    degree, label, paidOrderCount: 0, revenueCents: 0, costTrackedOrderCount: 0,
    estimatedAiCostCents: 0, loggedUsageCount: 0, loggedTokens: 0,
  }));
  // Read each usage row once. Joining usage and tasks would multiply both revenue and cost.
  const usageByOrder = new Map();
  for (const row of db.prepare(`SELECT u.* FROM usage_logs u JOIN orders o ON o.id=u.order_id
    WHERE o.paid_at>=? AND o.status IN ('paid','processing','completed') AND u.user_id=o.user_id`).all(since)) {
    if (!usageByOrder.has(row.order_id)) usageByOrder.set(row.order_id, []);
    usageByOrder.get(row.order_id).push(row);
  }
  for (const order of orders) {
    const group = groups.find((item) => item.degree === degreeTier(order));
    group.paidOrderCount++;
    group.revenueCents += Math.round(order.amount * 100);
    let tracked = false;
    for (const usage of usageByOrder.get(order.id) || []) {
      const tokens = Math.max(0, Number(usage.tokens) || 0);
      // Zero/absent token telemetry is unknown, not evidence of a free model call.
      if (!tokens) continue;
      tracked = true;
      const input = Math.max(0, Number(usage.input_chars) || 0);
      const output = Math.max(0, Number(usage.output_chars) || 0);
      const inputShare = input + output > 0 ? input / (input + output) : 0;
      group.estimatedAiCostCents += tokens / 10000
        * (inputShare * pricing.inputCostPerMillion + (1 - inputShare) * pricing.outputCostPerMillion);
      group.loggedUsageCount++;
      group.loggedTokens += tokens;
    }
    if (tracked) group.costTrackedOrderCount++;
  }
  return groups.map((group) => ({
    ...group,
    estimatedAiCostCents: group.costTrackedOrderCount ? rounded(group.estimatedAiCostCents) : null,
    averageOrderRevenueCents: group.paidOrderCount ? rounded(group.revenueCents / group.paidOrderCount) : null,
    averageAiCostCents: group.costTrackedOrderCount ? rounded(group.estimatedAiCostCents / group.costTrackedOrderCount) : null,
    estimatedGrossMargin: group.revenueCents > 0 && group.costTrackedOrderCount === group.paidOrderCount
      ? rounded((group.revenueCents - group.estimatedAiCostCents) / group.revenueCents) : null,
    costCoverage: group.paidOrderCount ? rounded(group.costTrackedOrderCount / group.paidOrderCount) : 0,
    costBasis: 'estimated_from_logged_total_tokens_and_character_ratio_at_current_rates',
  }));
}

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
    byDegreeTier: getDegreeOverview(since),
    degreeCostCaveat: '学位按订单快照归类，缺失时使用项目学位；成本为已关联订单的日志 token 按输入输出字符占比和当前单价粗估，无字符信息时按输出单价估算。平均成本仅包含有用量的订单；缺失成本时毛利率为 null。未关联日志、未记录调用、人工、支付、服务器和税费不计入，不能视为实际毛利。',
    caveat: '漏斗为时间窗内事件用户数，参考比率不是严格同批用户转化率；贡献利润暂未包含支付手续费、服务器、税费和无法归集到订单的模型调用成本。',
  };
}

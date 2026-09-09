import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { toast } from '../../components/Toast.jsx';
import { Refresh } from '../../components/Icons.jsx';

const yuan = (cents) => `¥${(Number(cents || 0) / 100).toFixed(2)}`;

export default function AdminOperations() {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState([]);
  const [business, setBusiness] = useState({ funnel: [], totals: {}, events: [], caveat: '' });
  const load = useCallback(async () => {
    try {
      const [operations, commercial] = await Promise.all([
        api.adminOperationalMetrics(days * 24), api.adminCommercialOverview(days),
      ]);
      setRows(operations.rows || []); setBusiness(commercial);
    } catch (error) { toast.error(error.message); }
  }, [days]);
  useEffect(() => { load(); }, [load]);
  const searches = useMemo(() => rows.filter((row) => row.metric === 'reference_search'), [rows]);
  const total = searches.reduce((sum, row) => sum + Number(row.count), 0);
  const success = searches.filter((row) => ['ok', 'partial'].includes(row.dimension)).reduce((sum, row) => sum + Number(row.count), 0);
  const averageMs = total ? Math.round(searches.reduce((sum, row) => sum + Number(row.total_value), 0) / total) : 0;
  const totals = business.totals || {};
  return <div className="mx-auto max-w-6xl px-6 py-8">
    <div className="flex items-end justify-between"><div><h1 className="text-xl font-bold text-ink">经营与运行监控</h1><p className="mt-1 text-sm text-slate-500">同时观察转化、收入、可归集成本、售后积压和核心技术可用性。</p></div><button className="btn-ghost text-xs" onClick={load}><Refresh className="h-4 w-4" />刷新</button></div>
    <select className="input mt-5 w-40" value={days} onChange={(event) => setDays(Number(event.target.value))}><option value="1">最近24小时</option><option value="7">最近7天</option><option value="30">最近30天</option><option value="90">最近90天</option></select>
    <h2 className="mt-7 font-semibold text-ink">业务漏斗</h2>
    <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{business.funnel.map((item) => <div className="card p-4" key={item.key}><div className="text-xs text-slate-500">{item.label}</div><div className="mt-1 text-xl font-bold text-ink">{item.count}</div><div className="mt-1 text-xs text-slate-400">参考比率 {item.conversion}%</div></div>)}</div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Card label="确认收入" value={yuan(totals.revenue_cents)} /><Card label="可归集人工成本" value={yuan(totals.human_cost_cents)} /><Card label="渠道佣金估算" value={yuan(totals.commission_cents)} /><Card label="贡献利润（未完全归集）" value={`${yuan(totals.contribution_cents)} · ${totals.contribution_margin || 0}%`} /></div>
    <div className="mt-3 grid gap-3 sm:grid-cols-3"><Card label="付费订单" value={totals.paid_orders || 0} /><Card label="人工服务线索" value={totals.expert_leads || 0} /><Card label="待处理售后" value={totals.pending_after_sales || 0} /></div>
    {business.caveat && <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800">口径提示：{business.caveat}</p>}
    <h2 className="mt-8 font-semibold text-ink">文献检索健康度</h2>
    <div className="mt-3 grid gap-4 sm:grid-cols-3"><Card label="检索次数" value={total} /><Card label="可用结果率" value={total ? `${Math.round(success / total * 100)}%` : '—'} /><Card label="平均耗时" value={total ? `${averageMs} ms` : '—'} /></div>
    <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-3">指标</th><th className="p-3">状态/数据源</th><th className="p-3">次数</th><th className="p-3">累计耗时</th></tr></thead><tbody>{rows.map((row) => <tr className="border-t" key={`${row.metric}:${row.dimension}`}><td className="p-3">{row.metric}</td><td className="p-3">{row.dimension || '—'}</td><td className="p-3">{row.count}</td><td className="p-3">{row.metric === 'reference_search' ? `${Math.round(row.total_value)} ms` : '—'}</td></tr>)}</tbody></table>{!rows.length && <div className="p-10 text-center text-sm text-slate-400">暂无运行数据</div>}</div>
  </div>;
}

function Card({ label, value }) { return <div className="card p-5"><div className="text-sm text-slate-500">{label}</div><div className="mt-2 text-xl font-bold text-ink">{value}</div></div>; }

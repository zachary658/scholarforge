import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { toast } from '../../components/Toast.jsx';
import { Refresh } from '../../components/Icons.jsx';

export default function AdminOperations() {
  const [hours, setHours] = useState(24);
  const [rows, setRows] = useState([]);
  const load = useCallback(async () => {
    try { setRows((await api.adminOperationalMetrics(hours)).rows || []); }
    catch (error) { toast.error(error.message); }
  }, [hours]);
  useEffect(() => { load(); }, [load]);
  const searches = useMemo(() => rows.filter((row) => row.metric === 'reference_search'), [rows]);
  const total = searches.reduce((sum, row) => sum + Number(row.count), 0);
  const success = searches.filter((row) => ['ok', 'partial'].includes(row.dimension)).reduce((sum, row) => sum + Number(row.count), 0);
  const averageMs = total ? Math.round(searches.reduce((sum, row) => sum + Number(row.total_value), 0) / total) : 0;
  return <div className="mx-auto max-w-5xl px-6 py-8">
    <div className="flex items-end justify-between"><div><h1 className="text-xl font-bold text-ink">运行监控</h1><p className="mt-1 text-sm text-slate-500">查看真实文献检索的成功率、耗时与各数据源状态。</p></div><button className="btn-ghost text-xs" onClick={load}><Refresh className="h-4 w-4" />刷新</button></div>
    <div className="mt-5 flex gap-2"><select className="input w-40" value={hours} onChange={(event) => setHours(Number(event.target.value))}><option value="24">最近24小时</option><option value="168">最近7天</option><option value="720">最近30天</option></select></div>
    <div className="mt-5 grid gap-4 sm:grid-cols-3"><Card label="检索次数" value={total} /><Card label="可用结果率" value={total ? `${Math.round(success / total * 100)}%` : '—'} /><Card label="平均耗时" value={total ? `${averageMs} ms` : '—'} /></div>
    <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-3">指标</th><th className="p-3">状态/数据源</th><th className="p-3">次数</th><th className="p-3">累计耗时</th></tr></thead><tbody>{rows.map((row) => <tr className="border-t" key={`${row.metric}:${row.dimension}`}><td className="p-3">{row.metric}</td><td className="p-3">{row.dimension || '—'}</td><td className="p-3">{row.count}</td><td className="p-3">{row.metric === 'reference_search' ? `${Math.round(row.total_value)} ms` : '—'}</td></tr>)}</tbody></table>{!rows.length && <div className="p-10 text-center text-sm text-slate-400">暂无运行数据，用户开始检索后会自动汇总</div>}</div>
  </div>;
}

function Card({ label, value }) { return <div className="card p-5"><div className="text-sm text-slate-500">{label}</div><div className="mt-2 text-2xl font-bold text-ink">{value}</div></div>; }

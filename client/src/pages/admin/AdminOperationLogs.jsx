import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Refresh, Shield } from '../../components/Icons.jsx';

const fmtTime = (value) => value ? new Date(Number(value) * 1000).toLocaleString('zh-CN') : '—';

export default function AdminOperationLogs() {
  const [data, setData] = useState({ items: [], page: 1, pages: 1, total: 0 });
  const [filters, setFilters] = useState({ actor: '', action: '', target: '', success: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = async (page = 1) => {
    setLoading(true); setError('');
    try { setData(await api.adminListOperationLogs({ ...filters, page, size: 20 })); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(1); }, []);
  return (
    <div className="mx-auto max-w-7xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div><h1 className="text-xl font-bold text-ink">操作审计</h1><p className="mt-1 text-sm text-slate-500">后台与客服写操作共 {data.total} 条</p></div>
        <button className="btn-ghost text-xs" onClick={() => load(data.page)}><Refresh className="h-4 w-4" />刷新</button>
      </div>
      <form className="mt-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); load(1); }}>
        <input className="input w-44" placeholder="操作者邮箱或 ID" value={filters.actor} onChange={(e) => setFilters({ ...filters, actor: e.target.value })} />
        <input className="input w-44" placeholder="操作路径" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} />
        <input className="input w-44" placeholder="目标类型或 ID" value={filters.target} onChange={(e) => setFilters({ ...filters, target: e.target.value })} />
        <select className="input w-32" value={filters.success} onChange={(e) => setFilters({ ...filters, success: e.target.value })}><option value="">全部结果</option><option value="true">成功</option><option value="false">失败</option></select>
        <button className="btn-primary" type="submit">筛选</button>
      </form>
      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}
      <div className="card mt-4 overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm"><thead><tr className="border-b bg-slate-50 text-left text-xs text-slate-500"><th className="px-4 py-3">时间</th><th className="px-4 py-3">操作者</th><th className="px-4 py-3">操作</th><th className="px-4 py-3">目标</th><th className="px-4 py-3">结果</th><th className="px-4 py-3">变更摘要</th></tr></thead>
          <tbody>{loading ? <tr><td colSpan={6} className="p-10 text-center text-slate-400">加载中…</td></tr> : data.items.length === 0 ? <tr><td colSpan={6} className="p-10 text-center text-slate-400"><Shield className="mx-auto mb-2 h-5 w-5" />暂无记录</td></tr> : data.items.map((row) => <tr key={row.id} className="border-b border-slate-100 align-top last:border-0"><td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{fmtTime(row.created_at)}</td><td className="px-4 py-3"><div>{row.actor_email || `ID ${row.actor_id}`}</div><div className="text-xs text-slate-400">{row.actor_role}</div></td><td className="px-4 py-3 font-mono text-xs">{row.action}</td><td className="px-4 py-3 text-xs">{row.target_type}{row.target_id ? ` #${row.target_id}` : ''}</td><td className="px-4 py-3"><span className={`rounded px-2 py-1 text-xs ${row.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{row.success ? '成功' : `失败 ${row.status_code}`}</span></td><td className="max-w-sm px-4 py-3"><details><summary className="cursor-pointer text-xs text-accent">查看前后值</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2 text-[11px]">{`修改前: ${row.before_json || '—'}\n修改后: ${row.after_json || '—'}`}</pre></details></td></tr>)}</tbody>
        </table>
      </div>
      {data.pages > 1 && <div className="mt-4 flex justify-between text-sm"><span>第 {data.page} / {data.pages} 页</span><div className="flex gap-2"><button className="btn-secondary" disabled={data.page <= 1} onClick={() => load(data.page - 1)}>上一页</button><button className="btn-secondary" disabled={data.page >= data.pages} onClick={() => load(data.page + 1)}>下一页</button></div></div>}
    </div>
  );
}

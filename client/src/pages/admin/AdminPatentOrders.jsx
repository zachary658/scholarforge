import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { toast } from '../../components/Toast.jsx';
import { Refresh } from '../../components/Icons.jsx';

const TYPE_LABEL = { invention: '发明专利', utility: '实用新型', design: '外观设计' };
const QUOTE_LABEL = { none: '待报价', pending: '待审批', approved: '已通过', rejected: '已驳回' };

// 管理端：专利申请订单（列表 / 对接状态 / 报价审批）
export default function AdminPatentOrders() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pendingOnly, setPendingOnly] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = { page: 1, size: 100 };
      const d = await api.adminListPatentOrders(params);
      const all = d.items || [];
      setItems(pendingOnly ? all.filter((i) => i.quote_status === 'pending') : all);
      setTotal(d.total || 0);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [pendingOnly]);

  const approve = async (id, status) => {
    try { await api.adminApprovePatentQuote(id, status); toast.success(status === 'approved' ? '已通过报价' : '已驳回报价'); load(); } catch (err) { toast.error(err.message); }
  };

  const updateContact = async (id, s) => {
    try { await api.adminUpdatePatentContact(id, s); toast.success('对接状态已更新'); load(); } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="px-8 py-8">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">专利申请管理</h1>
          <p className="mt-1 text-sm text-slate-500">共 {total} 条申请订单</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} /> 只看待审批
          </label>
          <button onClick={load} className="btn-ghost text-xs"><Refresh className="h-4 w-4" /> 刷新</button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
              <th className="px-4 py-3">用户</th>
              <th className="px-4 py-3">类型 / 名称</th>
              <th className="px-4 py-3">报价</th>
              <th className="px-4 py-3">审批状态</th>
              <th className="px-4 py-3">支付</th>
              <th className="px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b border-slate-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-ink">{it.user_name}</div>
                  <div className="text-xs text-slate-400">{it.user_email}</div>
                </td>
                <td className="px-4 py-3">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">{TYPE_LABEL[it.patent_type] || it.patent_type}</span>
                  <div className="mt-1 max-w-[220px] font-medium text-ink">{it.title}</div>
                </td>
                <td className="px-4 py-3">
                  {it.quoted_price != null ? <span className="font-medium text-accent">¥{Number(it.quoted_price).toFixed(2)}</span> : '—'}
                </td>
                <td className="px-4 py-3 text-xs">{QUOTE_LABEL[it.quote_status] || it.quote_status}</td>
                <td className="px-4 py-3 text-xs">{it.status === 'paid' ? <span className="text-emerald-600">已支付 ¥{Number(it.amount || 0).toFixed(2)}</span> : '未支付'}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    {it.quote_status === 'pending' && (
                      <>
                        <button onClick={() => approve(it.id, 'approved')} className="btn-primary px-2 py-1 text-[11px]">通过报价</button>
                        <button onClick={() => approve(it.id, 'rejected')} className="btn-ghost px-2 py-1 text-[11px] text-red-600">驳回</button>
                      </>
                    )}
                    <button onClick={() => updateContact(it.id, 'completed')} className="btn-ghost px-2 py-1 text-[11px]">标记完成</button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">{loading ? '加载中…' : '暂无申请订单'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

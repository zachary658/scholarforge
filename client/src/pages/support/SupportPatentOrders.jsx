import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { toast } from '../../components/Toast.jsx';
import { Refresh } from '../../components/Icons.jsx';

const TYPE_LABEL = { invention: '发明专利', utility: '实用新型', design: '外观设计' };
const QUOTE_LABEL = { none: '待报价', pending: '待审批', approved: '已通过', rejected: '已驳回' };

// 客服：专利申请对接（查看需求 / 标记对接 / 提交报价）
export default function SupportPatentOrders() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [quoteId, setQuoteId] = useState(null);
  const [quotePrice, setQuotePrice] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const params = { page: 1, size: 100 };
      if (status) params.status = status;
      const d = await api.supportListPatentOrders(params);
      setItems(d.items || []);
      setTotal(d.total || 0);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [status]);

  const updateContact = async (id, s) => {
    try { await api.supportUpdatePatentContact(id, s); toast.success('对接状态已更新'); load(); } catch (err) { toast.error(err.message); }
  };

  const submitQuote = async () => {
    const price = Number(quotePrice);
    if (!Number.isFinite(price) || price < 0) { toast.warning('请填写有效报价'); return; }
    try { await api.supportQuotePatentOrder(quoteId, price); toast.success('报价已提交，待管理员审批'); setQuoteId(null); setQuotePrice(''); load(); } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="px-8 py-8">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">专利申请对接</h1>
          <p className="mt-1 text-sm text-slate-500">共 {total} 条申请需求</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input w-32 py-1.5 text-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部状态</option>
            <option value="pending">待对接</option>
            <option value="contacted">已对接</option>
            <option value="completed">已完成</option>
          </select>
          <button onClick={load} className="btn-ghost text-xs"><Refresh className="h-4 w-4" /> 刷新</button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
              <th className="px-4 py-3">用户</th>
              <th className="px-4 py-3">专利类型 / 名称</th>
              <th className="px-4 py-3">技术方案</th>
              <th className="px-4 py-3">报价</th>
              <th className="px-4 py-3">对接状态</th>
              <th className="px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b border-slate-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-ink">{it.user_name}</div>
                  <div className="text-xs text-slate-400">{it.user_email}</div>
                  <div className="text-xs text-slate-400">{it.contact || '无联系方式'}</div>
                </td>
                <td className="px-4 py-3">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">{TYPE_LABEL[it.patent_type] || it.patent_type}</span>
                  <div className="mt-1 max-w-[220px] font-medium text-ink">{it.title}</div>
                </td>
                <td className="px-4 py-3 max-w-[260px] text-xs text-slate-600">
                  <div className="line-clamp-3">{(it.tech_description || '').slice(0, 200)}</div>
                </td>
                <td className="px-4 py-3">
                  {it.quoted_price != null ? <span className="font-medium text-accent">¥{Number(it.quoted_price).toFixed(2)}</span> : '—'}
                  <div className="text-[10px] text-slate-400">{QUOTE_LABEL[it.quote_status] || it.quote_status}</div>
                </td>
                <td className="px-4 py-3 text-xs">{it.contact_status === 'pending' ? '待对接' : it.contact_status === 'contacted' ? '已对接' : '已完成'}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    {it.status === 'pending' && (
                      <>
                        <button onClick={() => { setQuoteId(it.id); setQuotePrice(it.quoted_price != null ? String(it.quoted_price) : ''); }} className="btn-primary px-2 py-1 text-[11px]">报价</button>
                        <button onClick={() => updateContact(it.id, 'contacted')} className="btn-ghost px-2 py-1 text-[11px]">标记已对接</button>
                        <button onClick={() => updateContact(it.id, 'completed')} className="btn-ghost px-2 py-1 text-[11px]">标记完成</button>
                      </>
                    )}
                    {it.status === 'paid' && <span className="text-xs text-emerald-600">已支付 ¥{Number(it.amount || 0).toFixed(2)}</span>}
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">{loading ? '加载中…' : '暂无申请需求'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {quoteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) setQuoteId(null); }}>
          <div className="w-[360px] rounded-xl bg-white p-6 shadow-card">
            <h3 className="text-base font-semibold text-ink">提交报价</h3>
            <input className="input mt-4" type="number" step="0.01" placeholder="报价金额（元）" value={quotePrice} onChange={(e) => setQuotePrice(e.target.value)} />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setQuoteId(null)} className="btn-ghost px-4 py-2 text-sm">取消</button>
              <button onClick={submitQuote} className="btn-primary px-4 py-2 text-sm">提交（待审批）</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

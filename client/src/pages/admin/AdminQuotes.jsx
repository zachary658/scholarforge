import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Refresh, Save } from '../../components/Icons.jsx';
import { toast } from '../../components/Toast.jsx';
import { PAYMENT_METHOD_LABEL } from '../../lib/constants.js';

function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts) * 1000);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN');
}

export default function AdminQuotes() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState({}); // order id -> { price, note }
  const [savingId, setSavingId] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      // 拉取待报价与已报价订单，客服/管理员可在此填写或修改报价
      const data = await api.adminListOrders({ page: 1, size: 100, status: 'awaiting_quote' });
      const quotedData = await api.adminListOrders({ page: 1, size: 100, status: 'quoted' });
      const orders = [...(data.orders || []), ...(quotedData.orders || [])];
      setList(orders);
      const d = {};
      for (const o of orders) {
        d[o.id] = {
          price: o.quoted_price != null ? String(o.quoted_price) : '',
          note: o.quote_note || '',
        };
      }
      setDrafts(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const submit = async (o) => {
    const price = Number(drafts[o.id]?.price);
    if (!Number.isFinite(price) || price <= 0) {
      toast.warning('请填写有效的报价金额（大于 0）');
      return;
    }
    setSavingId(o.id);
    setError('');
    try {
      await api.adminQuoteOrder(o.id, { quoted_price: price, quote_note: drafts[o.id]?.note || '' });
      toast.success(`「${o.item_name || o.target_name || o.order_no}」已报价`);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">报价管理</h1>
          <p className="mt-1 text-sm text-slate-500">处理待报价 / 已报价的功能订单，填写报价金额后用户即可支付</p>
        </div>
        <button onClick={load} className="btn-ghost text-xs">
          <Refresh className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      <div className="card mt-6 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                <th className="px-4 py-3">订单号</th>
                <th className="px-4 py-3">用户</th>
                <th className="px-4 py-3">功能</th>
                <th className="px-4 py-3">用户需求</th>
                <th className="px-4 py-3">报价金额（元）</th>
                <th className="px-4 py-3">报价说明</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">加载中…</td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">暂无待报价订单</td>
                </tr>
              ) : (
                list.map((o) => (
                  <tr key={o.id} className="border-b border-slate-100 text-sm align-top last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{o.order_no}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{o.user_name || '—'}</div>
                      <div className="text-xs text-slate-400">{o.user_email || ''}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{o.item_name || o.target_name || '—'}</td>
                    <td className="px-4 py-3 max-w-[260px] whitespace-pre-wrap text-xs text-slate-500">
                      {o.custom_requirements || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        className="input w-28 py-1.5 text-sm"
                        value={drafts[o.id]?.price ?? ''}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [o.id]: { ...prev[o.id], price: e.target.value } }))}
                        placeholder="金额"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        className="input w-40 py-1.5 text-xs"
                        value={drafts[o.id]?.note ?? ''}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [o.id]: { ...prev[o.id], note: e.target.value } }))}
                        placeholder="可选说明"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-md px-2 py-0.5 text-xs ${o.status === 'quoted' ? 'bg-amber-50 text-amber-600' : 'bg-purple-50 text-purple-600'}`}>
                        {o.status === 'quoted' ? '已报价' : '待报价'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => submit(o)} disabled={savingId === o.id} className="btn-primary px-3 py-1.5 text-xs">
                        <Save className={`h-3.5 w-3.5 ${savingId === o.id ? 'animate-pulse' : ''}`} />
                        {savingId === o.id ? '保存中…' : '保存报价'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

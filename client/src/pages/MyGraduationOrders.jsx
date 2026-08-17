import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { toast } from '../components/Toast.jsx';
import { Refresh, Receipt, Wechat } from '../components/Icons.jsx';
import PayModal from '../components/PayModal.jsx';

const STATUS_BADGE = {
  pending: 'bg-amber-50 text-amber-600',
  paid: 'bg-green-50 text-green-600',
  closed: 'bg-slate-100 text-slate-500',
  refunded: 'bg-red-50 text-red-600',
};

const STATUS_LABEL = {
  pending: '待支付',
  paid: '已支付',
  closed: '已关闭',
  refunded: '已退款',
};

const CONTACT_BADGE = {
  pending: 'bg-amber-50 text-amber-600',
  contacted: 'bg-blue-50 text-blue-600',
  completed: 'bg-green-50 text-green-600',
};

const CONTACT_LABEL = {
  pending: '待对接',
  contacted: '已对接',
  completed: '已完成',
};

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts) * 1000);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('zh-CN');
}

function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts) * 1000);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN');
}

export default function MyGraduationOrders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [contactFilter, setContactFilter] = useState('');
  const [payOrder, setPayOrder] = useState(null);
  const [payParams, setPayParams] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.myGraduationOrders();
      setOrders(data.orders || []);
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePay = async (o) => {
    try {
      const data = await api.payGraduationOrder(o.id);
      setPayOrder(data.order);
      setPayParams(data.payParams);
    } catch (err) {
      toast.error(err.message);
    }
  };

  // 是否可支付：待支付且客服已报价（quoted_price > 0）
  const canPay = (o) => o.status === 'pending' && o.quoted_price != null && Number(o.quoted_price) > 0;

  useEffect(() => { load(); }, []);

  const filtered = orders.filter((o) => {
    if (statusFilter && o.status !== statusFilter) return false;
    if (contactFilter && o.contact_status !== contactFilter) return false;
    return true;
  });

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">我的毕业作品订单</h1>
          <p className="mt-1 text-sm text-slate-500">共 {orders.length} 条订单记录</p>
        </div>
        <button onClick={load} className="btn-ghost text-xs">
          <Refresh className="h-4 w-4" /> 刷新
        </button>
      </div>

      {/* 筛选 */}
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="label mb-0">支付状态</label>
          <select
            className="input w-36 py-2"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">全部</option>
            <option value="pending">待支付</option>
            <option value="paid">已支付</option>
            <option value="closed">已关闭</option>
            <option value="refunded">已退款</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="label mb-0">对接状态</label>
          <select
            className="input w-36 py-2"
            value={contactFilter}
            onChange={(e) => setContactFilter(e.target.value)}
          >
            <option value="">全部</option>
            <option value="pending">待对接</option>
            <option value="contacted">已对接</option>
            <option value="completed">已完成</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {/* 桌面端表格 */}
      <div className="card mt-4 hidden overflow-hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                <th className="px-4 py-3">项目名称</th>
                <th className="px-4 py-3">分类</th>
                <th className="px-4 py-3">订单号</th>
                <th className="px-4 py-3">金额</th>
                <th className="px-4 py-3">报价</th>
                <th className="px-4 py-3">支付</th>
                <th className="px-4 py-3">对接</th>
                <th className="px-4 py-3">购买时间</th>
                <th className="px-4 py-3">有效期</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-400">加载中…</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-400">
                    {orders.length === 0 ? '暂无订单' : '没有匹配的订单'}
                  </td>
                </tr>
              ) : (
                filtered.map((o) => (
                  <tr key={o.id} className="border-b border-slate-100 text-sm last:border-0">
                    <td className="px-4 py-3 font-medium text-ink">{o.project_title}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{o.category}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{o.order_no || '—'}</td>
                    <td className="px-4 py-3 font-medium text-ink">
                      {o.amount != null ? `¥${Number(o.amount).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {o.quoted_price != null ? (
                        <span className="font-medium text-accent">¥{Number(o.quoted_price).toFixed(2)}</span>
                      ) : (
                        <span className="text-slate-400">待报价</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-md px-2 py-0.5 text-xs ${STATUS_BADGE[o.status] || 'bg-slate-100 text-slate-500'}`}>
                          {STATUS_LABEL[o.status] || o.status}
                        </span>
                        {canPay(o) && (
                          <button
                            onClick={() => handlePay(o)}
                            className="rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-white hover:opacity-90"
                          >
                            去支付
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-md px-2 py-0.5 text-xs ${CONTACT_BADGE[o.contact_status] || 'bg-slate-100 text-slate-600'}`}>
                        {CONTACT_LABEL[o.contact_status] || o.contact_status || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{fmtDateTime(o.purchased_at)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {o.expires_at ? fmtDate(o.expires_at) : '长期'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 移动端卡片列表 */}
      <div className="mt-4 space-y-3 md:hidden">
        {loading ? (
          <div className="card p-6 text-center text-sm text-slate-400">加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="card p-6 text-center text-sm text-slate-400">
            {orders.length === 0 ? '暂无订单' : '没有匹配的订单'}
          </div>
        ) : (
          filtered.map((o) => (
            <div key={o.id} className="card p-4">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium text-ink">{o.project_title}</h3>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-500">{o.category}</span>
                    {o.order_no && (
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-slate-400">{o.order_no}</span>
                    )}
                  </div>
                </div>
                <div className="ml-3 flex shrink-0 flex-col items-end gap-1">
                  <span className={`rounded-md px-2 py-0.5 text-xs ${STATUS_BADGE[o.status] || 'bg-slate-100 text-slate-500'}`}>
                    {STATUS_LABEL[o.status] || o.status}
                  </span>
                  <span className={`rounded-md px-2 py-0.5 text-xs ${CONTACT_BADGE[o.contact_status] || 'bg-slate-100 text-slate-600'}`}>
                    {CONTACT_LABEL[o.contact_status] || o.contact_status || '—'}
                  </span>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
                <div className="space-y-0.5 text-slate-500">
                  <div>金额：{o.amount != null ? `¥${Number(o.amount).toFixed(2)}` : '—'}</div>
                  {o.quoted_price != null && (
                    <div>报价：<span className="font-medium text-accent">¥{Number(o.quoted_price).toFixed(2)}</span></div>
                  )}
                </div>
                <div className="space-y-0.5 text-right text-slate-400">
                  <div>{fmtDate(o.purchased_at)}</div>
                  {o.expires_at && <div>有效期至 {fmtDate(o.expires_at)}</div>}
                </div>
              </div>
              {o.requirements?.remark && (
                <div className="mt-3 flex items-start gap-1.5 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  <Receipt className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="line-clamp-3">{o.requirements.remark}</span>
                </div>
              )}
              {canPay(o) && (
                <button
                  onClick={() => handlePay(o)}
                  className="btn-primary mt-3 w-full py-2 text-sm"
                >
                  去支付 ¥{Number(o.quoted_price).toFixed(2)}
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* 统计摘要 */}
      {orders.length > 0 && (
        <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
            <Receipt className="h-4 w-4 text-slate-400" />
            订单摘要
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: '全部', count: orders.length },
              { label: '已支付', count: orders.filter((o) => o.status === 'paid').length },
              { label: '待支付', count: orders.filter((o) => o.status === 'pending').length },
              { label: '已完成对接', count: orders.filter((o) => o.contact_status === 'completed').length },
            ].map((s) => (
              <div key={s.label} className="rounded-md bg-white px-3 py-2 text-center shadow-soft">
                <div className="text-lg font-bold text-ink">{s.count}</div>
                <div className="text-xs text-slate-400">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {payOrder && payParams && (
        <PayModal
          order={payOrder}
          payParams={payParams}
          onClose={() => { setPayOrder(null); setPayParams(null); }}
          onPaid={() => { setPayOrder(null); setPayParams(null); load(); }}
        />
      )}
    </div>
  );
}
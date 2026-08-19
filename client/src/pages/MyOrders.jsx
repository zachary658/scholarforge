import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Refresh } from '../components/Icons.jsx';
import { toast } from '../components/Toast.jsx';
import PayModal from '../components/PayModal.jsx';

const STATUS_LABEL = { pending: '待支付', paid: '已支付', closed: '已关闭', refunded: '已退款' };
const STATUS_CLASS = {
  pending: 'bg-amber-50 text-amber-600',
  paid: 'bg-green-50 text-green-600',
  closed: 'bg-slate-100 text-slate-500',
  refunded: 'bg-red-50 text-red-600',
};
const TYPE_LABEL = { points_package: '积分充值', course: '课程' };
const CHANNEL_LABEL = { mock: '模拟', alipay: '支付宝', wechat: '微信' };

function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts) * 1000);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN');
}

export default function MyOrders() {
  const [list, setList] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payOrder, setPayOrder] = useState(null);
  const SIZE = 20;

  const load = async (p = page, st = status, ty = type) => {
    setLoading(true);
    setError('');
    try {
      const params = { page: p, size: SIZE };
      if (st) params.status = st;
      if (ty) params.type = ty;
      const data = await api.listOrders(params);
      setList(data.orders || []);
      setPage(data.page || p);
      setPages(data.pages || 1);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(1, '', ''); }, []);

  const onStatusChange = (v) => {
    setStatus(v);
    load(1, v, type);
  };

  const onTypeChange = (v) => {
    setType(v);
    load(1, status, v);
  };

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">我的订单</h1>
          <p className="mt-1 text-sm text-slate-500">共 {total} 条订单记录</p>
        </div>
        <button onClick={() => load(page)} className="btn-ghost text-xs">
          <Refresh className="h-4 w-4" /> 刷新
        </button>
      </div>

      {/* 筛选 */}
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="label mb-0">状态</label>
          <select
            className="input w-36 py-2"
            value={status}
            onChange={(e) => onStatusChange(e.target.value)}
          >
            <option value="">全部</option>
            <option value="pending">待支付</option>
            <option value="paid">已支付</option>
            <option value="closed">已关闭</option>
            <option value="refunded">已退款</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="label mb-0">类型</label>
          <select
            className="input w-36 py-2"
            value={type}
            onChange={(e) => onTypeChange(e.target.value)}
          >
            <option value="">全部</option>
            <option value="points_package">积分充值</option>
            <option value="course">课程</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      <div className="card mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                <th className="px-4 py-3">订单号</th>
                <th className="px-4 py-3">商品</th>
                <th className="px-4 py-3">类型</th>
                <th className="px-4 py-3">金额</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">支付方式</th>
                <th className="px-4 py-3">时间</th>
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
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">暂无订单</td>
                </tr>
              ) : (
                list.map((o) => (
                    <tr key={o.order_no} className="border-b border-slate-100 text-sm last:border-0">
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{o.order_no}</td>
                      <td className="px-4 py-3 font-medium text-ink">{o.target_name || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-md px-2 py-0.5 text-xs ${o.type === 'points_package' ? 'bg-accent-50 text-accent' : 'bg-slate-100 text-slate-600'}`}>
                          {TYPE_LABEL[o.type] || o.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-ink">¥{Number(o.amount).toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-md px-2 py-0.5 text-xs ${STATUS_CLASS[o.status] || 'bg-slate-100 text-slate-500'}`}>
                          {STATUS_LABEL[o.status] || o.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{CHANNEL_LABEL[o.payment_channel] || o.payment_channel || '—'}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{fmtDateTime(o.paid_at || o.created_at)}</td>
                      <td className="px-4 py-3 text-right">
                        {o.status === 'pending' ? (
                          <button
                            onClick={() => setPayOrder(o)}
                            className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:opacity-90"
                          >
                            去支付
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-slate-500">第 {page} / {pages} 页</span>
          <div className="flex gap-2">
            <button
              onClick={() => load(page - 1)}
              disabled={page <= 1}
              className="btn-secondary text-xs disabled:opacity-40"
            >
              上一页
            </button>
            <button
              onClick={() => load(page + 1)}
              disabled={page >= pages}
              className="btn-secondary text-xs disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        </div>
      )}

      {payOrder && (
        <PayModal
          order={payOrder}
          payParams={null}
          onClose={() => setPayOrder(null)}
          onPaid={() => { setPayOrder(null); load(page); toast.success('支付成功'); }}
        />
      )}
    </div>
  );
}

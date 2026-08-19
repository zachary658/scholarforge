import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Refresh, Download } from '../components/Icons.jsx';
import { toast } from '../components/Toast.jsx';
import PayModal from '../components/PayModal.jsx';
import {
  ORDER_STATUS_LABEL, ORDER_STATUS_CLASS, SERVICE_STATUS_LABEL, PAYMENT_METHOD_LABEL,
} from '../lib/constants.js';

const STATUS_FILTERS = [
  ['', '全部'],
  ['pending', '待支付'],
  ['awaiting_quote', '待报价'],
  ['quoted', '待支付（已报价）'],
  ['paid', '已支付'],
  ['processing', '服务中'],
  ['completed', '已完成'],
  ['cancelled', '已取消'],
];

function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts) * 1000);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN');
}

export default function MyOrders() {
  const navigate = useNavigate();
  const [list, setList] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payState, setPayState] = useState(null);
  const [payingNo, setPayingNo] = useState(null);
  const SIZE = 20;

  const load = async (p = page, st = status) => {
    setLoading(true);
    setError('');
    try {
      const params = { page: p, size: SIZE };
      if (st) params.status = st;
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

  useEffect(() => { load(1, ''); }, []);

  const onStatusChange = (v) => {
    setStatus(v);
    load(1, v);
  };

  // 已报价订单：接受并支付
  const acceptAndPay = async (o, method) => {
    setPayingNo(o.order_no);
    try {
      const data = await api.payOrder(o.order_no, { payment_method: method });
      setPayState(data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPayingNo(null);
    }
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

      {/* 状态筛选 */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map(([value, label]) => (
          <button
            key={value || 'all'}
            onClick={() => onStatusChange(value)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              status === value
                ? 'bg-accent text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
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
                <th className="px-4 py-3">功能</th>
                <th className="px-4 py-3">数量</th>
                <th className="px-4 py-3">金额</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">支付方式</th>
                <th className="px-4 py-3">服务进度</th>
                <th className="px-4 py-3">时间</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-400">加载中…</td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-400">暂无订单</td>
                </tr>
              ) : (
                list.map((o) => (
                  <tr key={o.order_no} className="border-b border-slate-100 text-sm align-top last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{o.order_no}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{o.item_name || o.target_name || '—'}</div>
                      {o.custom_requirements && (
                        <div className="mt-1 max-w-[240px] truncate text-xs text-slate-400" title={o.custom_requirements}>
                          需求：{o.custom_requirements}
                        </div>
                      )}
                      {o.quote_note && (
                        <div className="mt-1 max-w-[240px] truncate text-xs text-slate-400" title={o.quote_note}>
                          说明：{o.quote_note}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">×{o.quantity || 1}</td>
                    <td className="px-4 py-3 font-medium text-ink">¥{Number(o.amount || 0).toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-md px-2 py-0.5 text-xs ${ORDER_STATUS_CLASS[o.status] || 'bg-slate-100 text-slate-500'}`}>
                        {ORDER_STATUS_LABEL[o.status] || o.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{PAYMENT_METHOD_LABEL[o.payment_method || o.payment_channel] || o.payment_method || o.payment_channel || '—'}</td>
                    <td className="px-4 py-3">
                      {o.status === 'paid' || o.status === 'processing' || o.status === 'completed' ? (
                        <span className="text-xs text-slate-600">{SERVICE_STATUS_LABEL[o.service_status] || o.service_status}</span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{fmtDateTime(o.paid_at || o.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      {o.status === 'pending' || o.status === 'quoted' ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <select
                            className="input w-24 py-1.5 text-xs"
                            onChange={(e) => acceptAndPay(o, e.target.value)}
                            value=""
                            disabled={payingNo === o.order_no}
                          >
                            <option value="" disabled>接受并支付</option>
                            <option value="wechat">微信支付</option>
                            <option value="alipay">支付宝</option>
                          </select>
                        </div>
                      ) : o.status === 'completed' ? (
                        <button onClick={() => navigate('/app/docs')} className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/20">
                          <Download className="h-3.5 w-3.5" /> 查看文档
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
            <button onClick={() => load(page - 1)} disabled={page <= 1} className="btn-secondary text-xs disabled:opacity-40">上一页</button>
            <button onClick={() => load(page + 1)} disabled={page >= pages} className="btn-secondary text-xs disabled:opacity-40">下一页</button>
          </div>
        </div>
      )}

      {payState && (
        <PayModal
          order={payState.order}
          payParams={payState.payParams}
          onClose={() => setPayState(null)}
          onPaid={() => { setPayState(null); load(page); toast.success('支付成功'); }}
        />
      )}
    </div>
  );
}

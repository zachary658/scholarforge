import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Refresh, Download } from '../components/Icons.jsx';
import { toast } from '../components/Toast.jsx';
import PayModal from '../components/PayModal.jsx';
import GraduationOrdersPanel from './MyGraduationOrders.jsx';
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
  ['refunded', '已退款'],
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
  const [tab, setTab] = useState('feature'); // feature=功能订单 / graduation=毕业作品订单
  const [afterSalesOrder, setAfterSalesOrder] = useState(null);
  const [afterSalesForm, setAfterSalesForm] = useState({ request_type: 'technical_failure', reason: '' });
  const [submittingAfterSales, setSubmittingAfterSales] = useState(false);
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

  const openAfterSales = (order) => {
    const requestType = ['pending', 'quoted', 'awaiting_quote'].includes(order.status) ? 'cancel' : 'technical_failure';
    setAfterSalesOrder(order); setAfterSalesForm({ request_type: requestType, reason: '' });
  };
  const submitAfterSales = async () => {
    setSubmittingAfterSales(true);
    try {
      await api.requestAfterSales(afterSalesOrder.order_no, afterSalesForm);
      toast.success('售后申请已提交'); setAfterSalesOrder(null); await load(page, status);
    } catch (err) { toast.error(err.message); }
    finally { setSubmittingAfterSales(false); }
  };

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">我的订单</h1>
          <p className="mt-1 text-sm text-slate-500">
            {tab === 'feature' ? `共 ${total} 条订单记录` : '功能订单与毕业作品订单统一管理'}
          </p>
        </div>
        {tab === 'feature' && (
          <button onClick={() => load(page)} className="btn-ghost text-xs">
            <Refresh className="h-4 w-4" /> 刷新
          </button>
        )}
      </div>

      {/* 订单类型切换（P1-6：合并客户侧订单入口） */}
      <div className="mt-5 flex gap-1 border-b border-slate-200">
        {[
          { key: 'feature', label: '功能订单' },
          { key: 'graduation', label: '毕业作品订单' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition ${
              tab === t.key ? 'border-accent text-accent' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'graduation' ? (
        <div className="mt-6">
          <GraduationOrdersPanel />
        </div>
      ) : (
        <>
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
                      <div className="flex flex-col items-end gap-2">
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
                      {o.after_sales ? <span className="text-xs text-amber-700">售后：{({ pending:'待处理', approved:'已批准', rejected:'已拒绝', completed:'已完成' })[o.after_sales.status] || o.after_sales.status}</span> : ['pending','quoted','awaiting_quote','paid','processing','completed'].includes(o.status) && <button className="text-xs text-slate-500 underline hover:text-accent" onClick={() => openAfterSales(o)}>申请售后</button>}
                      </div>
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
      {afterSalesOrder && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"><h2 className="font-semibold text-ink">申请售后</h2><p className="mt-1 text-xs text-slate-500">订单 {afterSalesOrder.order_no} · ¥{Number(afterSalesOrder.amount || 0).toFixed(2)}</p><label className="mt-4 block text-sm">售后类型<select className="input mt-1" value={afterSalesForm.request_type} onChange={(event) => setAfterSalesForm({ ...afterSalesForm, request_type: event.target.value })}>{['pending','quoted','awaiting_quote'].includes(afterSalesOrder.status) ? <option value="cancel">取消未支付订单</option> : <><option value="technical_failure">技术故障/服务无法使用</option><option value="refund">其他退款申请</option></>}</select></label><label className="mt-4 block text-sm">问题说明<textarea className="input mt-1" rows="4" maxLength="2000" value={afterSalesForm.reason} onChange={(event) => setAfterSalesForm({ ...afterSalesForm, reason: event.target.value })} placeholder="请说明发生时间、功能和错误现象，便于快速核实" /></label><p className="mt-3 text-xs text-slate-500">提交不代表退款已经完成；平台核实后会在订单页更新处理结果。</p><div className="mt-5 flex justify-end gap-2"><button className="btn-secondary" onClick={() => setAfterSalesOrder(null)}>取消</button><button className="btn-primary" disabled={!afterSalesForm.reason.trim() || submittingAfterSales} onClick={submitAfterSales}>{submittingAfterSales ? '提交中…' : '提交申请'}</button></div></div></div>}
        </>
      )}
    </div>
  );
}

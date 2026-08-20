import { useEffect, useState, useRef } from 'react';
import { api } from '../../lib/api.js';
import { Search, X, Refresh } from '../../components/Icons.jsx';
import { toast } from '../../components/Toast.jsx';
import { useConfirm } from '../../components/ConfirmModal.jsx';
import {
  ORDER_STATUS_LABEL, ORDER_STATUS_CLASS, SERVICE_STATUS_LABEL, PAYMENT_METHOD_LABEL,
} from '../../lib/constants.js';

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'pending', label: '待支付' },
  { value: 'awaiting_quote', label: '待报价' },
  { value: 'quoted', label: '待支付（已报价）' },
  { value: 'paid', label: '已支付' },
  { value: 'processing', label: '服务中' },
  { value: 'completed', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
];

const TYPE_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'feature', label: '功能订单' },
  { value: 'course', label: '课程' },
  { value: 'graduation', label: '毕业作品' },
];

const TYPE_LABEL = {
  feature: '功能订单',
  course: '课程',
  graduation: '毕业作品',
};

function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts) * 1000);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN');
}

export default function AdminOrders() {
  const confirm = useConfirm();
  const [list, setList] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [quoteModal, setQuoteModal] = useState(null); // order
  const [quoteForm, setQuoteForm] = useState({ quoted_price: '', quote_note: '' });
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef(null);
  // 请求序号：筛选即时请求与搜索防抖请求并发时，丢弃过期响应（防慢响应覆盖新筛选结果）
  const requestSeqRef = useRef(0);

  const SIZE = 50;

  const buildParams = (overrides = {}) => {
    const p = { page: 1, size: SIZE };
    if (status) p.status = status;
    if (type) p.type = type;
    if (q.trim()) p.q = q.trim();
    return { ...p, ...overrides };
  };

  const load = async (p = 1) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.adminListOrders(buildParams({ page: p }));
      setList(data.orders || []);
      setPage(data.page || p);
      setPages(data.pages || 1);
      setTotal(data.total ?? (data.orders || []).length);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const onFilterChange = (setter) => (e) => {
    setter(e.target.value);
    const nextStatus = setter === setStatus ? e.target.value : status;
    const nextType = setter === setType ? e.target.value : type;
    const params = { page: 1, size: SIZE };
    if (nextStatus) params.status = nextStatus;
    if (nextType) params.type = nextType;
    if (q.trim()) params.q = q.trim();
    setLoading(true);
    setError('');
    const seq = ++requestSeqRef.current;
    api.adminListOrders(params)
      .then((data) => {
        if (seq !== requestSeqRef.current) return; // 过期响应，丢弃
        setList(data.orders || []);
        setPage(data.page || 1);
        setPages(data.pages || 1);
        setTotal(data.total ?? (data.orders || []).length);
      })
      .catch((err) => { if (seq === requestSeqRef.current) setError(err.message); })
      .finally(() => { if (seq === requestSeqRef.current) setLoading(false); });
  };

  const onSearchChange = (v) => {
    setQ(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = { page: 1, size: SIZE };
      if (status) params.status = status;
      if (type) params.type = type;
      if (v.trim()) params.q = v.trim();
      setLoading(true);
      setError('');
      const seq = ++requestSeqRef.current;
      api.adminListOrders(params)
        .then((data) => {
          if (seq !== requestSeqRef.current) return; // 过期响应，丢弃
          setList(data.orders || []);
          setPage(data.page || 1);
          setPages(data.pages || 1);
          setTotal(data.total ?? (data.orders || []).length);
        })
        .catch((err) => { if (seq === requestSeqRef.current) setError(err.message); })
        .finally(() => { if (seq === requestSeqRef.current) setLoading(false); });
    }, 350);
  };

  const openQuote = (o) => {
    setQuoteForm({ quoted_price: o.quoted_price != null ? String(o.quoted_price) : '', quote_note: o.quote_note || '' });
    setQuoteModal(o);
  };

  const submitQuote = async () => {
    if (!quoteModal) return;
    const price = Number(quoteForm.quoted_price);
    if (!Number.isFinite(price) || price <= 0) {
      toast.warning('请填写有效的报价金额（大于 0）');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.adminQuoteOrder(quoteModal.id, { quoted_price: price, quote_note: quoteForm.quote_note });
      toast.success('报价已提交，订单状态已更新为待支付');
      setQuoteModal(null);
      load(page);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const markPaid = async (o) => {
    if (!await confirm({
      title: '标记支付确认',
      message: `确认将订单「${o.order_no}」手动标记为已支付？仅用于测试/线下收款补录。`,
      danger: true,
      confirmText: '标记已支付',
    })) return;
    setSaving(true);
    setError('');
    try {
      await api.adminMarkPaid(o.id);
      toast.success('订单已标记为已支付');
      load(page);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">订单管理</h1>
          <p className="mt-1 text-sm text-slate-500">共 {total} 条订单</p>
        </div>
        <button onClick={() => load(page)} className="btn-ghost text-xs">
          <Refresh className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {/* 筛选栏 */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <select className="input w-auto" value={status} onChange={onFilterChange(setStatus)}>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <select className="input w-auto" value={type} onChange={onFilterChange(setType)}>
          {TYPE_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input w-56 pl-9"
            placeholder="搜索订单号 / 用户"
            value={q}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      <div className="card mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                <th className="px-4 py-3">订单号</th>
                <th className="px-4 py-3">用户</th>
                <th className="px-4 py-3">商品</th>
                <th className="px-4 py-3">类型</th>
                <th className="px-4 py-3">金额</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">服务进度</th>
                <th className="px-4 py-3">支付方式</th>
                <th className="px-4 py-3">支付时间</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-400">加载中…</td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-400">暂无订单</td>
                </tr>
              ) : (
                list.map((o) => {
                  const st = o.status || 'pending';
                  return (
                    <tr key={o.order_no} className="border-b border-slate-100 text-sm align-top last:border-0">
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-slate-600">{o.order_no}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-ink">{o.user_name || '—'}</div>
                        <div className="text-xs text-slate-400">{o.user_email || ''}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-slate-700">{o.item_name || o.target_name || '—'}</div>
                        {o.quantity > 1 && <div className="text-xs text-slate-400">×{o.quantity}</div>}
                        {o.custom_requirements && (
                          <div className="mt-0.5 max-w-[240px] truncate text-xs text-slate-400" title={o.custom_requirements}>
                            需求：{o.custom_requirements}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{TYPE_LABEL[o.type] || o.type}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">¥{Number(o.amount ?? 0).toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-md px-2 py-0.5 text-xs ${ORDER_STATUS_CLASS[st] || 'bg-slate-100 text-slate-600'}`}>
                          {ORDER_STATUS_LABEL[st] || st}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {SERVICE_STATUS_LABEL[o.service_status] || o.service_status || '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {PAYMENT_METHOD_LABEL[o.payment_method || o.payment_channel] || o.payment_method || o.payment_channel || '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{fmtDateTime(o.paid_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-1">
                          {(st === 'awaiting_quote' || st === 'quoted') && (
                            <button onClick={() => openQuote(o)} className="btn-ghost text-xs text-accent">
                              报价
                            </button>
                          )}
                          {(st === 'pending' || st === 'quoted') && (
                            <button onClick={() => markPaid(o)} className="btn-ghost text-xs">
                              标记支付
                            </button>
                          )}
                          {(st !== 'awaiting_quote' && st !== 'quoted' && st !== 'pending') && (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 分页 */}
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-slate-500">第 {page} / {pages} 页</span>
          <div className="flex gap-2">
            <button onClick={() => load(page - 1)} disabled={page <= 1} className="btn-secondary text-xs disabled:opacity-40">上一页</button>
            <button onClick={() => load(page + 1)} disabled={page >= pages} className="btn-secondary text-xs disabled:opacity-40">下一页</button>
          </div>
        </div>
      )}

      {/* 报价 Modal */}
      {quoteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-[460px] max-w-full rounded-xl bg-white shadow-card">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="text-base font-semibold text-ink">订单报价</h3>
              <button onClick={() => setQuoteModal(null)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-ink">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 px-6 py-5">
              <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
                <div className="text-slate-500">订单号</div>
                <div className="mt-0.5 font-mono text-xs text-slate-700">{quoteModal.order_no}</div>
                <div className="mt-2 text-slate-500">功能</div>
                <div className="mt-0.5 text-slate-700">{quoteModal.item_name || quoteModal.target_name || '—'}</div>
                {quoteModal.custom_requirements && (
                  <>
                    <div className="mt-2 text-slate-500">用户需求</div>
                    <div className="mt-0.5 whitespace-pre-wrap text-xs text-slate-700">{quoteModal.custom_requirements}</div>
                  </>
                )}
              </div>
              <div>
                <label className="label">报价金额（元）</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="input"
                  value={quoteForm.quoted_price}
                  onChange={(e) => setQuoteForm({ ...quoteForm, quoted_price: e.target.value })}
                  placeholder="例如：88.00"
                />
              </div>
              <div>
                <label className="label">报价说明（可选）</label>
                <textarea
                  className="input min-h-[70px] resize-none"
                  value={quoteForm.quote_note}
                  onChange={(e) => setQuoteForm({ ...quoteForm, quote_note: e.target.value })}
                  placeholder="说明报价依据、服务范围等"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button onClick={() => setQuoteModal(null)} className="btn-secondary">取消</button>
              <button onClick={submitQuote} disabled={saving} className="btn-primary">
                {saving ? '保存中…' : '提交报价'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

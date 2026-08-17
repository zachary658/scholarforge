import { useEffect, useState, useRef } from 'react';
import { api } from '../../lib/api.js';
import { Search, X, Refresh } from '../../components/Icons.jsx';
import { toast } from '../../components/Toast.jsx';
import { useConfirm } from '../../components/ConfirmModal.jsx';

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'pending', label: '待支付' },
  { value: 'paid', label: '已支付' },
  { value: 'closed', label: '已关闭' },
  { value: 'refunded', label: '已退款' },
];

const TYPE_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'points_package', label: '积分套餐' },
  { value: 'course', label: '课程' },
];

const STATUS_BADGE = {
  pending: 'bg-amber-50 text-amber-600',
  paid: 'bg-green-50 text-green-600',
  closed: 'bg-slate-100 text-slate-600',
  refunded: 'bg-red-50 text-red-600',
};

const STATUS_LABEL = {
  pending: '待支付',
  paid: '已支付',
  closed: '已关闭',
  refunded: '已退款',
};

const CHANNEL_LABEL = {
  mock: '模拟',
  alipay: '支付宝',
  wechat: '微信',
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
  const [refundModal, setRefundModal] = useState(null); // order
  const [refundReason, setRefundReason] = useState('');
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef(null);

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
    // 状态/类型变化立即重新加载
    const nextStatus = setter === setStatus ? e.target.value : status;
    const nextType = setter === setType ? e.target.value : type;
    const params = { page: 1, size: SIZE };
    if (nextStatus) params.status = nextStatus;
    if (nextType) params.type = nextType;
    if (q.trim()) params.q = q.trim();
    setLoading(true);
    setError('');
    api.adminListOrders(params)
      .then((data) => {
        setList(data.orders || []);
        setPage(data.page || 1);
        setPages(data.pages || 1);
        setTotal(data.total ?? (data.orders || []).length);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
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
      api.adminListOrders(params)
        .then((data) => {
          setList(data.orders || []);
          setPage(data.page || 1);
          setPages(data.pages || 1);
          setTotal(data.total ?? (data.orders || []).length);
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }, 350);
  };

  const openRefund = (o) => {
    setRefundReason('');
    setRefundModal(o);
  };

  const submitRefund = async () => {
    if (!refundModal) return;
    if (!refundReason.trim()) {
      toast.warning('请填写退款原因');
      return;
    }
    if (!await confirm({
      title: '退款确认',
      message: `确认退款订单「${refundModal.order_no}」共 ¥${Number(refundModal.amount ?? 0).toFixed(2)}？此操作不可撤销。`,
      danger: true,
      confirmText: '确认退款',
    })) return;
    setSaving(true);
    setError('');
    try {
      await api.adminRefundOrder(refundModal.order_no, refundReason.trim());
      toast.success('订单已退款');
      setRefundModal(null);
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
        <select
          className="input w-auto"
          value={status}
          onChange={onFilterChange(setStatus)}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <select
          className="input w-auto"
          value={type}
          onChange={onFilterChange(setType)}
        >
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
                <th className="px-4 py-3">支付方式</th>
                <th className="px-4 py-3">支付时间</th>
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
                list.map((o) => {
                  const st = o.status || 'pending';
                  const isPackage = o.type === 'points_package';
                  const isCourse = o.type === 'course';
                  return (
                    <tr key={o.order_no} className="border-b border-slate-100 text-sm last:border-0">
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-slate-600">{o.order_no}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-ink">{o.user_name || '—'}</div>
                        <div className="text-xs text-slate-400">{o.user_email || ''}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{o.target_name || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-md px-2 py-0.5 text-xs ${isPackage ? 'bg-accent-50 text-accent-700' : isCourse ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-600'}`}>
                          {isPackage ? '积分套餐' : isCourse ? '课程' : '功能'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">¥{Number(o.amount ?? 0).toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-md px-2 py-0.5 text-xs ${STATUS_BADGE[st] || 'bg-slate-100 text-slate-600'}`}>
                          {STATUS_LABEL[st] || st}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {CHANNEL_LABEL[o.payment_channel] || o.payment_channel || '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{fmtDateTime(o.paid_at)}</td>
                      <td className="px-4 py-3 text-right">
                        {st === 'paid' ? (
                          <button onClick={() => openRefund(o)} className="btn-ghost text-xs text-red-500 hover:bg-red-50">
                            退款
                          </button>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
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

      {/* 退款 Modal */}
      {refundModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-[440px] max-w-full rounded-xl bg-white shadow-card">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="text-base font-semibold text-ink">订单退款</h3>
              <button onClick={() => setRefundModal(null)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-ink">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 px-6 py-5">
              <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
                <div className="text-slate-500">订单号</div>
                <div className="mt-0.5 font-mono text-xs text-slate-700">{refundModal.order_no}</div>
                <div className="mt-2 text-slate-500">商品</div>
                <div className="mt-0.5 text-slate-700">{refundModal.target_name}</div>
                <div className="mt-2 text-slate-500">金额</div>
                <div className="mt-0.5 text-slate-700">¥{Number(refundModal.amount ?? 0).toFixed(2)}</div>
              </div>
              <div>
                <label className="label">退款原因</label>
                <textarea
                  className="input min-h-[80px] resize-none"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="请填写退款原因"
                />
                <p className="mt-1.5 text-xs text-slate-400">退款后订单状态将变为已退款，请谨慎操作</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button onClick={() => setRefundModal(null)} className="btn-secondary">取消</button>
              <button onClick={submitRefund} disabled={saving} className="btn-primary text-red-600 bg-red-50 hover:bg-red-100">
                {saving ? '处理中…' : '确认退款'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

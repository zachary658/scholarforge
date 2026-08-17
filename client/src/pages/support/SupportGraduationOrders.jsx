import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Refresh, Check, X, Search, Receipt } from '../../components/Icons.jsx';
import { toast } from '../../components/Toast.jsx';
import OrderNotes from '../../components/OrderNotes.jsx';

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'pending', label: '待对接' },
  { value: 'contacted', label: '已对接' },
  { value: 'completed', label: '已完成' },
];

const STATUS_BADGE = {
  pending: 'bg-amber-50 text-amber-600',
  contacted: 'bg-blue-50 text-blue-600',
  completed: 'bg-green-50 text-green-600',
};

const STATUS_LABEL = {
  pending: '待对接',
  contacted: '已对接',
  completed: '已完成',
};

const NEXT_STATUS = { pending: 'contacted', contacted: 'completed', completed: 'pending' };
const NEXT_LABEL = { pending: '标记已对接', contacted: '标记已完成', completed: '重置为待对接' };

const QUOTE_STATUS = {
  none: { label: '未报价', badge: 'bg-slate-100 text-slate-500' },
  pending: { label: '报价待审批', badge: 'bg-amber-50 text-amber-600' },
  approved: { label: '报价已生效', badge: 'bg-green-50 text-green-600' },
  rejected: { label: '报价已驳回', badge: 'bg-red-50 text-red-600' },
};

function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts) * 1000);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN');
}

function fmtPrice(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  return `¥${n.toFixed(2)}`;
}

function JsonPreview({ data }) {
  if (!data) return <span className="text-slate-400">—</span>;
  let str;
  try {
    str = typeof data === 'string' ? JSON.stringify(JSON.parse(data), null, 2) : JSON.stringify(data, null, 2);
  } catch {
    str = String(data);
  }
  return <pre className="max-h-40 overflow-auto rounded-md bg-slate-50 p-2 text-xs text-slate-700 whitespace-pre-wrap">{str}</pre>;
}

export default function SupportGraduationOrders() {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState(null);
  // 报价编辑状态
  const [quotingId, setQuotingId] = useState(null);
  const [quotePrice, setQuotePrice] = useState('');
  const [quotingSaving, setQuotingSaving] = useState(false);
  // 详情抽屉
  const [detail, setDetail] = useState(null);

  const SIZE = 20;

  const load = async (p = 1, st = status, kw = q) => {
    setLoading(true);
    setError('');
    try {
      const params = { page: p, size: SIZE };
      if (st) params.status = st;
      if (kw) params.q = kw;
      const data = await api.supportListGraduationOrders(params);
      setItems(data.items || []);
      setPage(data.page || p);
      setPages(data.pages || 1);
      setTotal(data.total ?? (data.items || []).length);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(1); }, []);

  const onStatusChange = (e) => {
    const v = e.target.value;
    setStatus(v);
    load(1, v, q);
  };

  const onSearch = () => load(1, status, q);

  const toggleStatus = async (item) => {
    const next = NEXT_STATUS[item.contact_status] || 'contacted';
    setUpdatingId(item.id);
    setError('');
    try {
      await api.supportUpdateGraduationContact(item.id, next);
      toast.success(`已更新为「${STATUS_LABEL[next]}」`);
      load(page, status, q);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUpdatingId(null);
    }
  };

  const openQuote = (item) => {
    setQuotingId(item.id);
    setQuotePrice(item.quoted_price != null ? String(item.quoted_price) : '');
  };

  const cancelQuote = () => {
    setQuotingId(null);
    setQuotePrice('');
    setQuotingSaving(false);
  };

  const saveQuote = async (item) => {
    const price = Number(quotePrice);
    if (isNaN(price) || price < 0) {
      toast.warning('请输入有效的报价金额');
      return;
    }
    setQuotingSaving(true);
    try {
      await api.supportQuoteGraduationOrder(item.id, price);
      toast.success('报价已提交，待管理员审批后生效');
      cancelQuote();
      load(page, status, q);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setQuotingSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">毕业设计对接</h1>
          <p className="mt-1 text-sm text-slate-500">查看毕业设计订单与需求，报价（提交后待管理员审批）、标记对接状态</p>
        </div>
        <button onClick={() => load(page, status, q)} className="btn-ghost text-xs">
          <Refresh className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            className="input w-56 py-2 text-sm"
            placeholder="搜邮箱 / 姓名 / 项目 / 订单号"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSearch(); }}
          />
        </div>
        <select className="input w-auto py-2" value={status} onChange={onStatusChange}>
          {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <span className="text-sm text-slate-500">共 {total} 条</span>
      </div>

      <div className="card mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                <th className="px-4 py-3">用户</th>
                <th className="px-4 py-3">项目</th>
                <th className="px-4 py-3">报价</th>
                <th className="px-4 py-3">报价状态</th>
                <th className="px-4 py-3">对接状态</th>
                <th className="px-4 py-3">购买时间</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">加载中…</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">暂无毕业设计订单</td>
                </tr>
              ) : (
                items.map((it) => {
                  const qs = QUOTE_STATUS[it.quote_status] || QUOTE_STATUS.none;
                  return (
                    <tr key={it.id} className="border-b border-slate-100 text-sm last:border-0">
                      <td className="px-4 py-3">
                        <div className="font-medium text-ink">{it.user_name || '—'}</div>
                        <div className="text-xs text-slate-400">{it.user_email || ''}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="max-w-[180px] text-ink truncate" title={it.project_title}>{it.project_title || '—'}</div>
                        <div className="text-xs text-slate-400">{it.category || ''}</div>
                      </td>
                      <td className="px-4 py-3">
                        {quotingId === it.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              className="input w-24 py-1 text-xs"
                              value={quotePrice}
                              onChange={(e) => setQuotePrice(e.target.value)}
                              step="0.01"
                            />
                            <button onClick={() => saveQuote(it)} disabled={quotingSaving} className="btn-primary px-2 py-1 text-xs">
                              {quotingSaving ? '...' : '提交'}
                            </button>
                            <button onClick={cancelQuote} className="btn-ghost px-1 py-1 text-xs">取消</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-slate-700">{fmtPrice(it.quoted_price)}</span>
                            {it.status === 'pending' && (
                              <button onClick={() => openQuote(it)} className="text-xs text-accent hover:underline">报价</button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-md px-2 py-0.5 text-xs ${qs.badge}`}>{qs.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-md px-2 py-0.5 text-xs ${STATUS_BADGE[it.contact_status] || 'bg-slate-100 text-slate-600'}`}>
                          {STATUS_LABEL[it.contact_status] || it.contact_status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{fmtDateTime(it.purchased_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => setDetail(it)} className="btn-ghost text-xs">
                            <Receipt className="h-3.5 w-3.5" /> 详情
                          </button>
                          <button
                            onClick={() => toggleStatus(it)}
                            disabled={updatingId === it.id}
                            className="btn-ghost text-xs"
                          >
                            {updatingId === it.id ? <Refresh className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            {NEXT_LABEL[it.contact_status] || '更新状态'}
                          </button>
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

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-slate-500">第 {page} / {pages} 页</span>
          <div className="flex gap-2">
            <button onClick={() => load(page - 1, status, q)} disabled={page <= 1} className="btn-secondary text-xs disabled:opacity-40">上一页</button>
            <button onClick={() => load(page + 1, status, q)} disabled={page >= pages} className="btn-secondary text-xs disabled:opacity-40">下一页</button>
          </div>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDetail(null)} />
          <div className="relative mx-4 w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-ink">{detail.project_title}</h3>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span>{detail.category || ''}</span>
                  <span>{detail.user_name} · {detail.user_email}</span>
                </div>
              </div>
              <button onClick={() => setDetail(null)} className="btn-ghost p-1"><X className="h-4 w-4" /></button>
            </div>

            {detail.requirements?.contact && (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm">
                <span className="font-medium text-green-800">联系方式：</span>
                <span className="text-green-700">{detail.requirements.contact}</span>
              </div>
            )}

            <div className="mt-4">
              <div className="text-xs font-semibold text-slate-500">需求详情</div>
              <div className="mt-2"><JsonPreview data={detail.requirements} /></div>
            </div>

            <div className="mt-4">
              <OrderNotes orderType="graduation" orderRefId={detail.id} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

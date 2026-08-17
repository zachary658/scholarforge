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

function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts) * 1000);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN');
}

function reqSummary(r) {
  if (!r) return '—';
  const parts = [];
  if (r.major) parts.push(r.major);
  if (r.paper_type) parts.push(r.paper_type);
  if (r.word_count) parts.push(`${r.word_count} 字`);
  if (r.chart_count) parts.push(`图表${r.chart_count}`);
  if (r.drawing_count) parts.push(`图纸${r.drawing_count}`);
  if (r.formula && r.formula !== '无') parts.push(`公式${r.formula}`);
  if (r.urgent) parts.push('加急');
  return parts.join(' · ') || '—';
}

export default function SupportCourseOrders() {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState(null);
  const [detail, setDetail] = useState(null);

  const SIZE = 20;

  const load = async (p = 1, st = status, kw = q) => {
    setLoading(true);
    setError('');
    try {
      const params = { page: p, size: SIZE };
      if (st) params.status = st;
      if (kw) params.q = kw;
      const data = await api.supportListCourseOrders(params);
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
      await api.supportUpdateCourseContact(item.id, next);
      toast.success(`已更新为「${STATUS_LABEL[next]}」`);
      load(page, status, q);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">课程对接</h1>
          <p className="mt-1 text-sm text-slate-500">查看已支付课程订单与需求，标记客服对接状态</p>
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
            placeholder="搜邮箱 / 姓名 / 课程 / 订单号"
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
                <th className="px-4 py-3">课程</th>
                <th className="px-4 py-3">需求摘要</th>
                <th className="px-4 py-3">金额</th>
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
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">暂无课程订单</td>
                </tr>
              ) : (
                items.map((it) => (
                  <tr key={it.id} className="border-b border-slate-100 text-sm last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{it.user_name || '—'}</div>
                      <div className="text-xs text-slate-400">{it.user_email || ''}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-ink">{it.course_title || '—'}</div>
                      {it.degree && <div className="text-xs text-slate-400">{it.degree}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="max-w-[220px] text-xs text-slate-600 line-clamp-2">{reqSummary(it.requirements)}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">¥{Number(it.amount ?? 0).toFixed(2)}</td>
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
                <h3 className="text-lg font-semibold text-ink">{detail.course_title}</h3>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span>{detail.degree || ''}</span>
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
              <div className="mt-2 space-y-1 rounded-md bg-slate-50 p-3 text-sm">
                <DetailRow label="专业" value={detail.requirements?.major} />
                <DetailRow label="论文类型" value={detail.requirements?.paper_type} />
                <DetailRow label="字数" value={detail.requirements?.word_count ? `${detail.requirements.word_count} 字` : '—'} />
                <DetailRow label="图表/图纸" value={`${detail.requirements?.chart_count || 0} 张 / ${detail.requirements?.drawing_count || 0} 张`} />
                <DetailRow label="公式复杂度" value={detail.requirements?.formula || '无'} />
                <DetailRow label="加急" value={detail.requirements?.urgent ? '是' : '否'} />
                <DetailRow label="补充说明" value={detail.requirements?.note || '—'} />
              </div>
            </div>

            <div className="mt-4">
              <OrderNotes orderType="course" orderRefId={detail.id} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 text-slate-400">{label}</span>
      <span className="text-ink">{value || '—'}</span>
    </div>
  );
}

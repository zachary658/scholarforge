import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Refresh, Check } from '../../components/Icons.jsx';
import { toast } from '../../components/Toast.jsx';

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

// 对接状态流转：待对接 → 已对接 → 已完成 → 待对接
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

export default function AdminCourseOrders() {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const SIZE = 20;

  const load = async (p = 1, st = status) => {
    setLoading(true);
    setError('');
    try {
      const params = { page: p, size: SIZE };
      if (st) params.status = st;
      const data = await api.adminListCourseOrders(params);
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
    load(1, v);
  };

  const toggleStatus = async (item) => {
    const next = NEXT_STATUS[item.contact_status] || 'contacted';
    setUpdatingId(item.id);
    setError('');
    try {
      await api.adminUpdateCourseContact(item.id, next);
      toast.success(`已更新为「${STATUS_LABEL[next]}」`);
      load(page, status);
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
          <p className="mt-1 text-sm text-slate-500">查看已支付课程订单与需求，标记客服对接状态，避免漏单</p>
        </div>
        <button onClick={() => load(page, status)} className="btn-ghost text-xs">
          <Refresh className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      <div className="mt-6 flex items-center gap-3">
        <select className="input w-auto" value={status} onChange={onStatusChange}>
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
                <th className="px-4 py-3">购买时间</th>
                <th className="px-4 py-3">对接状态</th>
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
                      <div className="max-w-[260px] text-xs text-slate-600">
                        {expandedId === it.id ? (
                          <DetailSummary r={it.requirements} />
                        ) : (
                          <>
                            <span className="line-clamp-2">{reqSummary(it.requirements)}</span>
                            {it.requirements && (
                              <button onClick={() => setExpandedId(it.id)} className="mt-1 text-accent hover:underline">展开详情</button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">¥{Number(it.amount ?? 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{fmtDateTime(it.purchased_at)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-md px-2 py-0.5 text-xs ${STATUS_BADGE[it.contact_status] || 'bg-slate-100 text-slate-600'}`}>
                        {STATUS_LABEL[it.contact_status] || it.contact_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => toggleStatus(it)}
                        disabled={updatingId === it.id}
                        className="btn-ghost text-xs"
                      >
                        {updatingId === it.id ? (
                          <Refresh className="h-3.5 w-3.5 animate-spin" />
                        ) : it.contact_status === 'completed' ? (
                          <Refresh className="h-3.5 w-3.5" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        {NEXT_LABEL[it.contact_status] || '更新状态'}
                      </button>
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
            <button onClick={() => load(page - 1, status)} disabled={page <= 1} className="btn-secondary text-xs disabled:opacity-40">上一页</button>
            <button onClick={() => load(page + 1, status)} disabled={page >= pages} className="btn-secondary text-xs disabled:opacity-40">下一页</button>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailSummary({ r }) {
  if (!r) return <span className="text-slate-400">—</span>;
  const rows = [
    ['专业', r.major],
    ['论文类型', r.paper_type],
    ['字数', r.word_count ? `${r.word_count} 字` : '—'],
    ['图表', r.chart_count ? `${r.chart_count} 张` : '0 张'],
    ['图纸', r.drawing_count ? `${r.drawing_count} 张` : '0 张'],
    ['公式复杂度', r.formula || '无'],
    ['加急', r.urgent ? '是' : '否'],
    ['补充说明', r.note || '—'],
  ];
  return (
    <div className="space-y-1 rounded-md bg-slate-50 p-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <span className="shrink-0 text-slate-400">{k}</span>
          <span className="text-ink">{v}</span>
        </div>
      ))}
    </div>
  );
}

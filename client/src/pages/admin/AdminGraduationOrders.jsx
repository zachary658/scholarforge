import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Refresh, Check, Plus, X } from '../../components/Icons.jsx';
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
  if (typeof r === 'string') {
    try { r = JSON.parse(r); } catch { return r; }
  }
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

export default function AdminGraduationOrders() {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  // 报价编辑状态
  const [quotingId, setQuotingId] = useState(null);
  const [quotePrice, setQuotePrice] = useState('');
  const [quotingSaving, setQuotingSaving] = useState(false);
  // 新建订单（线下成交补录）
  const [projects, setProjects] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ email: '', project_id: '', remark: '', quoted_price: '' });
  const [createSaving, setCreateSaving] = useState(false);

  const SIZE = 20;

  const load = async (p = 1, st = status) => {
    setLoading(true);
    setError('');
    try {
      const params = { page: p, size: SIZE };
      if (st) params.status = st;
      const data = await api.adminListGraduationOrders(params);
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

  const loadProjects = async () => {
    try {
      const data = await api.adminListGraduationProjects();
      setProjects((data.projects || []).filter((p) => p.is_active));
    } catch {
      setProjects([]);
    }
  };

  const submitCreate = async () => {
    if (!createForm.email.trim() || !createForm.project_id) {
      toast.warning('请填写用户邮箱并选择项目');
      return;
    }
    setCreateSaving(true);
    try {
      await api.adminCreateGraduationOrder({
        email: createForm.email.trim(),
        project_id: Number(createForm.project_id),
        requirements: createForm.remark.trim() ? { remark: createForm.remark.trim() } : null,
        quoted_price: createForm.quoted_price,
      });
      toast.success('订单已创建');
      setShowCreate(false);
      setCreateForm({ email: '', project_id: '', remark: '', quoted_price: '' });
      load(page, status);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCreateSaving(false);
    }
  };

  useEffect(() => { load(1); loadProjects(); }, []);

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
      await api.adminUpdateGraduationContact(item.id, next);
      toast.success(`已更新为「${STATUS_LABEL[next]}」`);
      load(page, status);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUpdatingId(null);
    }
  };

  const openQuote = (item) => {
    setQuotingId(item.id);
    setQuotePrice(item.quoted_price != null ? String(item.quoted_price) : String(item.base_price ?? 0));
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
      await api.adminQuoteGraduationOrder(item.id, price);
      toast.success('报价已更新');
      cancelQuote();
      load(page, status);
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
          <h1 className="text-xl font-bold text-ink">毕业作品订单</h1>
          <p className="mt-1 text-sm text-slate-500">查看毕业作品订单与需求，标记客服对接状态，设置报价</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCreate(true)} className="btn-primary text-xs">
            <Plus className="h-4 w-4" /> 新建订单
          </button>
          <button onClick={() => load(page, status)} className="btn-ghost text-xs">
            <Refresh className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
          </button>
        </div>
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
                <th className="px-4 py-3">毕业作品</th>
                <th className="px-4 py-3">需求摘要</th>
                <th className="px-4 py-3">报价</th>
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
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">暂无毕业作品订单</td>
                </tr>
              ) : (
                items.map((it) => (
                  <tr key={it.id} className="border-b border-slate-100 text-sm last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{it.user_name || '—'}</div>
                      <div className="text-xs text-slate-400">{it.user_email || ''}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-ink">{it.project_title || '—'}</div>
                      {it.category && <div className="text-xs text-slate-400">{it.category}</div>}
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
                          <button
                            onClick={() => saveQuote(it)}
                            disabled={quotingSaving}
                            className="btn-primary text-xs py-1 px-2"
                          >
                            {quotingSaving ? '...' : '保存'}
                          </button>
                          <button onClick={cancelQuote} className="btn-ghost text-xs py-1 px-1">
                            取消
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-700">
                            {it.quoted_price != null ? `¥${Number(it.quoted_price).toFixed(2)}` : '未报价'}
                          </span>
                          <button
                            onClick={() => openQuote(it)}
                            className="text-xs text-accent hover:underline"
                          >
                            报价
                          </button>
                        </div>
                      )}
                    </td>
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

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowCreate(false)} />
          <div className="relative mx-4 w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-ink">新建毕业作品订单</h3>
              <button onClick={() => setShowCreate(false)} className="btn-ghost p-1">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="label">用户邮箱</label>
                <input className="input" placeholder="输入已注册用户的邮箱" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} />
              </div>
              <div>
                <label className="label">毕业作品项目</label>
                <select className="input" value={createForm.project_id} onChange={(e) => setCreateForm({ ...createForm, project_id: e.target.value })}>
                  <option value="">请选择项目</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.title}（{p.category}）</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">需求备注（选填）</label>
                <textarea className="input min-h-[80px] resize-y" placeholder="客户需求描述" value={createForm.remark} onChange={(e) => setCreateForm({ ...createForm, remark: e.target.value })} />
              </div>
              <div>
                <label className="label">报价金额（选填）</label>
                <input className="input" type="number" step="0.01" placeholder="0.00" value={createForm.quoted_price} onChange={(e) => setCreateForm({ ...createForm, quoted_price: e.target.value })} />
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button onClick={() => setShowCreate(false)} className="btn-secondary flex-1">取消</button>
              <button onClick={submitCreate} disabled={createSaving} className="btn-primary flex-1 disabled:opacity-50">
                {createSaving ? '创建中…' : '创建订单'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailSummary({ r }) {
  if (!r) return <span className="text-slate-400">—</span>;
  if (typeof r === 'string') {
    try { r = JSON.parse(r); } catch { return <span className="text-ink">{r}</span>; }
  }
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
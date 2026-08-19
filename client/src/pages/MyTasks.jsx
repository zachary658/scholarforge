import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmModal.jsx';
import { TOOL_LABEL, TOOL_COLOR, CHARGE_LABEL } from '../lib/constants.js';
import {
  Refresh, Search, Trash, Eye, Download, Filter, ChevronLeft, ChevronRight,
  FileText, Edit, SpellCheck, Languages, Copy, Layers,
  Book, FileWord,
} from '../components/Icons.jsx';

const TOOL_ICON = {
  writing: Edit, proposal: FileText, polish: SpellCheck,
  translate: Languages, grammar: SpellCheck, rewrite: Copy,
  ai_reduce: Refresh,
  literature_review: Book, task_book: FileText,
  defense: FileWord, journal: FileText,
};

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function MyTasks() {
  const toast = useToast();
  const confirm = useConfirm();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [toolType, setToolType] = useState('');
  const [detail, setDetail] = useState(null); // 查看详情的任务

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, size: 20 };
      if (keyword) params.q = keyword;
      if (toolType) params.toolType = toolType;
      const d = await api.listTasks(params);
      setTasks(d.tasks || []);
      setPages(d.pages || 1);
      setTotal(d.total || 0);
    } catch (err) {
      toast.error('加载失败：' + err.message);
    } finally {
      setLoading(false);
    }
  }, [page, keyword, toolType]);

  useEffect(() => { load(); }, [load]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    load();
  };

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: '删除任务记录',
      message: '删除后无法恢复，确定要删除这条任务记录吗？',
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteTask(id);
      toast.success('已删除');
      load();
    } catch (err) {
      toast.error('删除失败：' + err.message);
    }
  };

  const handleViewDetail = async (id) => {
    try {
      const d = await api.getTask(id);
      setDetail(d.task);
    } catch (err) {
      toast.error('加载详情失败：' + err.message);
    }
  };

  const handleCopyOutput = async (text) => {
    try {
      if (!navigator.clipboard) { toast.error('复制失败，请手动复制'); return; }
      await navigator.clipboard.writeText(text);
      toast.success('已复制到剪贴板');
    } catch {
      toast.error('复制失败，请手动复制');
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">我的任务历史</h1>
          <p className="mt-1 text-sm text-slate-500">所有 AI 调用记录均保存在此，可随时回看（保留 90 天）</p>
        </div>
        <button onClick={load} disabled={loading} className="btn-ghost text-sm">
          <Refresh className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* 搜索筛选 */}
      <form onSubmit={handleSearch} className="mt-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索任务标题、输入或输出内容…"
            className="input pl-10"
          />
        </div>
        <select
          value={toolType}
          onChange={(e) => { setToolType(e.target.value); setPage(1); }}
          className="input w-auto"
        >
          <option value="">全部工具</option>
          {Object.entries(TOOL_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button type="submit" className="btn-primary">
          <Filter className="h-4 w-4" /> 筛选
        </button>
      </form>

      {/* 统计 */}
      <div className="mt-4 text-sm text-slate-500">
        共 {total} 条记录{pages > 1 ? ` · 第 ${page}/${pages} 页` : ''}
      </div>

      {/* 任务列表 */}
      <div className="mt-4 space-y-3">
        {loading && tasks.length === 0 && (
          <div className="card p-8 text-center text-sm text-slate-400">加载中…</div>
        )}
        {!loading && tasks.length === 0 && (
          <div className="card p-12 text-center">
            <Layers className="mx-auto h-12 w-12 text-slate-300" />
            <p className="mt-3 text-sm text-slate-400">暂无任务记录</p>
            <p className="mt-1 text-xs text-slate-400">使用任何 AI 工具后，记录会自动保存在这里</p>
          </div>
        )}
        {tasks.map((t) => {
          const Icon = TOOL_ICON[t.tool_type] || FileText;
          const color = TOOL_COLOR[t.tool_type] || 'bg-slate-50 text-slate-600';
          return (
            <div key={t.id} className="card p-4 hover:shadow-md transition">
              <div className="flex items-start gap-3">
                <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${color}`}>
                  <Icon className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink truncate">{t.title || `${t.tool_type}-${t.action}`}</span>
                    <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-xs ${color}`}>
                      {TOOL_LABEL[t.tool_type] || t.tool_type}
                    </span>
                    {t.project_title && (
                      <span className="flex-shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                        {t.project_title}
                      </span>
                    )}
                  </div>
                  {t.output_preview && (
                    <p className="mt-1.5 text-sm text-slate-500 line-clamp-2">{t.output_preview}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                    <span>{fmtDate(t.created_at)}</span>
                    {t.model_name && <span>模型: {t.model_name}</span>}
                    {t.tokens > 0 && <span>{t.tokens} tokens</span>}
                    <span className={`rounded px-1.5 py-0.5 ${t.charge_type === 'paid' ? 'bg-green-50 text-green-600' : 'bg-slate-50 text-slate-500'}`}>
                      {CHARGE_LABEL[t.charge_type] || t.charge_type}
                    </span>
                    {t.amount > 0 && <span>¥{t.amount}</span>}
                    <span>输入 {t.input_len || 0} 字</span>
                    <span>输出 {t.output_len || 0} 字</span>
                  </div>
                </div>
                <div className="flex flex-shrink-0 gap-1">
                  <button
                    onClick={() => handleViewDetail(t.id)}
                    className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-accent"
                    title="查看详情"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(t.id)}
                    className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-500"
                    title="删除"
                  >
                    <Trash className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 分页 */}
      {pages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="btn-ghost text-sm disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" /> 上一页
          </button>
          <span className="text-sm text-slate-500">{page} / {pages}</span>
          <button
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page >= pages}
            className="btn-ghost text-sm disabled:opacity-40"
          >
            下一页 <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 详情弹窗 */}
      {detail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => e.target === e.currentTarget && setDetail(null)}
        >
          <div className="flex max-h-[85vh] w-[700px] max-w-full flex-col rounded-xl bg-white shadow-card">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="font-semibold text-ink">任务详情</h3>
              <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="mb-4 flex flex-wrap gap-2 text-xs">
                <span className={`rounded px-2 py-1 ${TOOL_COLOR[detail.tool_type] || 'bg-slate-50 text-slate-600'}`}>
                  {TOOL_LABEL[detail.tool_type] || detail.tool_type}
                </span>
                <span className="rounded bg-slate-100 px-2 py-1 text-slate-600">{detail.action}</span>
                <span className="rounded bg-slate-100 px-2 py-1 text-slate-500">{fmtDate(detail.created_at)}</span>
                {detail.model_name && <span className="rounded bg-slate-100 px-2 py-1 text-slate-500">{detail.model_name}</span>}
                {detail.tokens > 0 && <span className="rounded bg-slate-100 px-2 py-1 text-slate-500">{detail.tokens} tokens</span>}
                <span className="rounded bg-slate-100 px-2 py-1 text-slate-500">{CHARGE_LABEL[detail.charge_type] || detail.charge_type}</span>
                {detail.context_summary && (
                  <span className="rounded bg-blue-50 px-2 py-1 text-blue-600">上下文: {detail.context_summary}</span>
                )}
              </div>

              <div className="mb-4">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-ink">输入内容</h4>
                  <span className="text-xs text-slate-400">{(detail.input_text || '').length} 字</span>
                </div>
                <div className="max-h-[200px] overflow-y-auto rounded-lg bg-slate-50 p-3 text-sm text-slate-700 whitespace-pre-wrap">
                  {detail.input_text || '(空)'}
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-ink">AI 输出结果</h4>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">{(detail.output_text || '').length} 字</span>
                    <button
                      onClick={() => handleCopyOutput(detail.output_text)}
                      className="flex items-center gap-1 rounded px-2 py-1 text-xs text-accent hover:bg-accent-50"
                    >
                      <Copy className="h-3 w-3" /> 复制
                    </button>
                  </div>
                </div>
                <div className="max-h-[300px] overflow-y-auto rounded-lg bg-blue-50/50 p-3 text-sm text-slate-700 whitespace-pre-wrap">
                  {detail.output_text || '(空)'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

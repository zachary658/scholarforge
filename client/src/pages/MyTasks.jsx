import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmModal.jsx';
import Modal from '../components/Modal.jsx';
import { TOOL_LABEL, TOOL_COLOR, CHARGE_LABEL } from '../lib/constants.js';
import {
  Refresh, Search, Trash, Eye, Download, Filter, ChevronLeft, ChevronRight,
  FileText, Edit, SpellCheck, Languages, Copy, Layers,
  Book, FileWord, AlertCircle,
} from '../components/Icons.jsx';

const TOOL_ICON = {
  writing: Edit, proposal: FileText, polish: SpellCheck,
  translate: Languages, grammar: SpellCheck, rewrite: Copy,
  ai_reduce: Refresh,
  literature_review: Book, task_book: FileText,
  defense: FileWord, journal: FileText,
};

// 失败任务错误分类（对应后端 classifyTaskError 的 error_code）：
// 客户端绝不展示内部异常堆栈，只展示可理解文案与下一步指引。
const ERROR_CODE_META = {
  network_timeout: { label: '网络超时', retryable: true, hint: '网络不稳定导致生成超时，可重新执行（不重复扣费）' },
  ai_unavailable: { label: 'AI 服务暂不可用', retryable: true, hint: 'AI 服务繁忙，可稍后重新执行（不重复扣费）' },
  input_too_long: { label: '输入内容过长', retryable: false, hint: '请精简输入后重新提交' },
  material_parse_failed: { label: '资料解析失败', retryable: false, hint: '请检查上传资料格式后重试' },
  order_error: { label: '余额或订单异常', retryable: false, hint: '请联系客服处理' },
  internal_error: { label: '系统内部错误', retryable: false, hint: '请联系客服处理' },
};

function errorMeta(code) {
  return ERROR_CODE_META[code] || ERROR_CODE_META.internal_error;
}

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
  const [retentionDays, setRetentionDays] = useState(30);
  const [retryingId, setRetryingId] = useState(null); // 正在重试的任务 id
  const loadSeqRef = useRef(0); // 列表请求序号：旧响应若已被更新请求超越则丢弃

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    try {
      const params = { page, size: 20 };
      if (keyword) params.q = keyword;
      if (toolType) params.toolType = toolType;
      const d = await api.listTasks(params);
      if (seq !== loadSeqRef.current) return; // 已有更新的请求发出，丢弃旧响应
      setTasks(d.tasks || []);
      setPages(d.pages || 1);
      setTotal(d.total || 0);
      if (d.retention_days) setRetentionDays(d.retention_days);
    } catch (err) {
      if (seq !== loadSeqRef.current) return; // 已有更新的请求发出，丢弃旧响应
      toast.error('加载失败：' + err.message);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
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

  // 轮询后台任务状态：retry 返回 202 后，前端轮询 GET /tasks/:id 直到 success/failed
  const pollTask = useCallback((id) => {
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        const d = await api.getTask(id);
        const t = d.task;
        if (t.status !== 'processing') {
          clearInterval(timer);
          setRetryingId(null);
          if (t.status === 'success') toast.success('重新执行完成');
          else toast.error('重新执行失败：' + errorMeta(t.error_code).label);
          load();
        } else if (Date.now() - started > 10 * 60 * 1000) {
          clearInterval(timer);
          setRetryingId(null);
          toast.error('处理超时，请稍后在任务列表查看结果');
          load();
        }
      } catch {
        clearInterval(timer);
        setRetryingId(null);
        load();
      }
    }, 2000);
  }, [load]);

  // 重新执行：后端 202 立即返回，后台执行，前端轮询结果
  const handleRetry = async (task) => {
    setRetryingId(task.id);
    try {
      await api.retryTask(task.id);
      toast.info('已提交重新执行，正在后台处理…');
      pollTask(task.id);
    } catch (err) {
      toast.error('重试失败：' + err.message);
      setRetryingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">我的任务历史</h1>
          <p className="mt-1 text-sm text-slate-500">所有 AI 生成记录均保存在此，可随时回看</p>
        </div>
        <button onClick={load} disabled={loading} className="btn-ghost text-sm">
          <Refresh className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* 保留期提醒：内容到期自动清理，提醒用户及时下载保存 */}
      <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          任务记录保留 <strong>{retentionDays} 天</strong>，到期后自动清理，请及时下载 Word 文档保存到本地，避免内容丢失。
        </span>
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
                  {t.status === 'processing' && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-blue-600">
                      <Refresh className="h-3.5 w-3.5 animate-spin" /> 处理中…
                    </div>
                  )}
                  {t.status === 'failed' && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
                        <AlertCircle className="h-3.5 w-3.5" />
                        {errorMeta(t.error_code).label}
                      </span>
                      <span className="text-xs text-slate-500">{errorMeta(t.error_code).hint}</span>
                    </div>
                  )}
                </div>
                <div className="flex flex-shrink-0 gap-1">
                  {t.status === 'failed' && errorMeta(t.error_code).retryable && (
                    <button
                      onClick={() => handleRetry(t)}
                      disabled={retryingId === t.id}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-accent hover:bg-accent-50 disabled:opacity-50"
                      title="重新执行"
                    >
                      <Refresh className={`h-3.5 w-3.5 ${retryingId === t.id ? 'animate-spin' : ''}`} /> {retryingId === t.id ? '重试中…' : '重新执行'}
                    </button>
                  )}
                  {t.status === 'failed' && !errorMeta(t.error_code).retryable && (
                    <span className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500" title="联系客服">
                      联系客服
                    </span>
                  )}
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
        <Modal onClose={() => setDetail(null)} label="任务详情" panelClassName="flex max-h-[85vh] w-[700px] flex-col">
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

              {detail.status === 'failed' && (
                <div className="mb-4 rounded-lg bg-red-50 px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-red-600">
                    <AlertCircle className="h-4 w-4" />
                    {errorMeta(detail.error_code).label}
                  </div>
                  <p className="mt-1 text-xs text-red-500">{errorMeta(detail.error_code).hint}</p>
                </div>
              )}

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
        </Modal>
      )}
    </div>
  );
}

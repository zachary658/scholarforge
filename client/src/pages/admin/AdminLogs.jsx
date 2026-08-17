import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Activity, Refresh } from '../../components/Icons.jsx';

const TOOL_LABEL = {
  writing: '写作',
  polish: '润色',
  translate: '翻译',
  grammar: '语法',
};

const TOOL_OPTIONS = [
  { value: '', label: '全部工具' },
  { value: 'writing', label: '写作' },
  { value: 'polish', label: '润色' },
  { value: 'translate', label: '翻译' },
  { value: 'grammar', label: '语法' },
];

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'success', label: '成功' },
  { value: 'failed', label: '失败' },
];

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts) * 1000);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN');
}

export default function AdminLogs() {
  const [logs, setLogs] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [tool, setTool] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const SIZE = 20;

  const load = async (p = 1) => {
    setLoading(true);
    setError('');
    try {
      const params = { page: p, size: SIZE };
      if (tool) params.tool = tool;
      if (status) params.status = status;
      const data = await api.adminListLogs(params);
      setLogs(data.logs || data.items || []);
      setPage(data.page || p);
      setPages(data.pages || 1);
      setTotal(data.total ?? (data.logs || data.items || []).length);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1);
  }, []);

  const onFilterChange = (setter) => (e) => {
    setter(e.target.value);
    setPage(1);
    load(1);
  };

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">使用日志</h1>
          <p className="mt-1 text-sm text-slate-500">共 {total} 条记录</p>
        </div>
        <button onClick={() => load(page)} className="btn-ghost text-xs">
          <Refresh className="h-4 w-4" /> 刷新
        </button>
      </div>

      {/* 筛选栏 */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-500">工具</label>
          <select className="input w-32 py-2 text-sm" value={tool} onChange={onFilterChange(setTool)}>
            {TOOL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-500">状态</label>
          <select className="input w-32 py-2 text-sm" value={status} onChange={onFilterChange(setStatus)}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      <div className="card mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                <th className="px-4 py-3">时间</th>
                <th className="px-4 py-3">用户</th>
                <th className="px-4 py-3">工具</th>
                <th className="px-4 py-3">操作</th>
                <th className="px-4 py-3">模型</th>
                <th className="px-4 py-3 text-right">输入字数</th>
                <th className="px-4 py-3 text-right">输出字数</th>
                <th className="px-4 py-3 text-right">Tokens</th>
                <th className="px-4 py-3">状态</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-400">加载中…</td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                        <Activity className="h-5 w-5" />
                      </div>
                      <p className="mt-3 text-sm text-slate-500">暂无日志记录</p>
                      <p className="mt-1 text-xs text-slate-400">用户使用 AI 工具后会在此显示</p>
                    </div>
                  </td>
                </tr>
              ) : (
                logs.map((l, idx) => {
                  const ok = l.status !== 'failed';
                  return (
                    <tr key={l.id ?? idx} className="border-b border-slate-100 text-sm last:border-0">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{fmtTime(l.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="text-xs font-medium text-ink">{l.user_name || l.name || '—'}</div>
                        <div className="text-xs text-slate-400">{l.user_email || l.email || ''}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          {TOOL_LABEL[l.tool_type] || l.tool_type || l.tool || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{l.action || '—'}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{l.model_name || '—'}</td>
                      <td className="px-4 py-3 text-right text-xs text-slate-600">{(l.input_chars ?? l.input_words ?? 0).toLocaleString('zh-CN')}</td>
                      <td className="px-4 py-3 text-right text-xs text-slate-600">{(l.output_chars ?? l.output_words ?? 0).toLocaleString('zh-CN')}</td>
                      <td className="px-4 py-3 text-right text-xs text-slate-600">{(l.tokens ?? 0).toLocaleString('zh-CN')}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-md px-2 py-0.5 text-xs ${ok ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                          {ok ? '成功' : '失败'}
                        </span>
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
    </div>
  );
}

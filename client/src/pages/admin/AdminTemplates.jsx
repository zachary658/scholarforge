import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Trash, Refresh } from '../../components/Icons.jsx';
import { toast } from '../../components/Toast.jsx';
import { useConfirm } from '../../components/ConfirmModal.jsx';

function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts) * 1000);
  if (isNaN(d.getTime())) {
    // 兼容已是毫秒或 ISO 字符串
    const d2 = new Date(ts);
    if (!isNaN(d2.getTime())) return d2.toLocaleString('zh-CN');
    return '—';
  }
  return d.toLocaleString('zh-CN');
}

export default function AdminTemplates() {
  const confirm = useConfirm();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.adminListTemplates();
      setTemplates(Array.isArray(data.templates) ? data.templates : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const remove = async (t) => {
    if (!await confirm({
      title: '删除确认',
      message: `确认删除「${t.name}」？此操作不可撤销。`,
      danger: true,
      confirmText: '删除',
    })) return;
    setError('');
    try {
      await api.adminDeleteTemplate(t.id);
      toast.success('模板已删除');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">模板管理</h1>
          <p className="mt-1 text-sm text-slate-500">查看与删除所有模板（用户在用户端上传自己的模板）</p>
        </div>
        <button onClick={load} className="btn-ghost text-xs">
          <Refresh className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      <div className="card mt-6 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                <th className="px-4 py-3">名称</th>
                <th className="px-4 py-3">类型</th>
                <th className="px-4 py-3">上传者</th>
                <th className="px-4 py-3">创建时间</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-400">加载中…</td>
                </tr>
              ) : templates.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-400">暂无模板</td>
                </tr>
              ) : (
                templates.map((t) => {
                  const isGlobal = t.is_global === true || t.is_global === 'true' || t.is_global === 1;
                  return (
                    <tr key={t.id} className="border-b border-slate-100 text-sm last:border-0">
                      <td className="px-4 py-3 font-medium text-ink">{t.name || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-md px-2 py-0.5 text-xs ${isGlobal ? 'bg-accent-50 text-accent-700' : 'bg-slate-100 text-slate-600'}`}>
                          {isGlobal ? '全局' : '用户'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{t.user_id ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{fmtDateTime(t.created_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => remove(t)}
                          className="btn-ghost text-xs text-red-500 hover:bg-red-50"
                        >
                          <Trash className="h-3.5 w-3.5" /> 删除
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

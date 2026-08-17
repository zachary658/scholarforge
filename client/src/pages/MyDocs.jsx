import { useEffect, useState } from 'react';
import { api, downloadDocFile } from '../lib/api.js';
import { FileWord, Download, Trash, Refresh, FileText } from '../components/Icons.jsx';
import { toast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmModal.jsx';

const FEATURE_LABEL = {
  writing_outline: '写作大纲',
  writing_paragraph: '段落续写',
  writing_abstract: '摘要',
  writing_fulltext: '全文',
  proposal: '开题报告',
};

function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts) * 1000);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN');
}

export default function MyDocs() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloadingId, setDownloadingId] = useState(null);

  const confirm = useConfirm();

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.listDocs();
      setDocs(data.docs || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleDownload = async (d) => {
    setDownloadingId(d.id);
    setError('');
    try {
      await downloadDocFile(d.id, d.title);
      toast.success('下载已开始');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (d) => {
    if (!await confirm({ title: '删除确认', message: `确认删除文档「${d.title}」？删除后不可恢复。`, danger: true, confirmText: '删除' })) return;
    setError('');
    try {
      await api.deleteDoc(d.id);
      toast.success('文档已删除');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">我的文档</h1>
          <p className="mt-1 text-sm text-slate-500">写作与开题报告生成的 Word 文档</p>
        </div>
        <button onClick={load} className="btn-ghost text-xs">
          <Refresh className="h-4 w-4" /> 刷新
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {loading ? (
        <div className="card mt-6 p-10 text-center text-sm text-slate-400">加载中…</div>
      ) : docs.length === 0 ? (
        <div className="card mt-6 flex flex-col items-center justify-center py-16 text-center">
          <FileText className="h-12 w-12 text-slate-300" />
          <p className="mt-4 text-sm text-slate-500">还没有生成文档</p>
          <p className="mt-1 text-xs text-slate-400">使用写作或开题报告工具后，生成的 Word 文档会自动保存到这里</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {docs.map((d) => (
            <div key={d.id} className="card flex flex-col p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent">
                  <FileWord className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold text-ink" title={d.title}>{d.title}</h3>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {FEATURE_LABEL[d.feature] || d.feature || '文档'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-3 text-xs text-slate-400">{fmtDateTime(d.created_at)}</div>
              <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4">
                <button
                  onClick={() => handleDownload(d)}
                  disabled={downloadingId === d.id}
                  className="btn-primary flex-1 text-xs"
                >
                  {downloadingId === d.id ? (
                    <><Refresh className="h-3.5 w-3.5 animate-spin" /> 下载中…</>
                  ) : (
                    <><Download className="h-3.5 w-3.5" /> 下载</>
                  )}
                </button>
                <button
                  onClick={() => handleDelete(d)}
                  className="btn-ghost text-xs text-red-500 hover:bg-red-50"
                >
                  <Trash className="h-3.5 w-3.5" /> 删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

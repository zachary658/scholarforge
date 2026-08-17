import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Layers, Plus, Trash, Refresh, FileWord } from '../components/Icons.jsx';
import { toast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmModal.jsx';

function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts) * 1000);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN');
}

export default function MyTemplates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const confirm = useConfirm();

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.listTemplates();
      setTemplates(data.templates || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const onFileChange = (e) => {
    const f = e.target.files?.[0];
    setFile(f || null);
    if (f && !name) {
      setName(f.name.replace(/\.docx$/i, ''));
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError('请选择 .docx 文件');
      return;
    }
    if (!file.name.toLowerCase().endsWith('.docx')) {
      setError('仅支持 .docx 格式文件');
      return;
    }
    setUploading(true);
    setError('');
    try {
      await api.uploadTemplate(file, name.trim());
      toast.success('模板上传成功');
      setName('');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (t) => {
    if (!await confirm({ title: '删除确认', message: `确认删除模板「${t.name}」？`, danger: true, confirmText: '删除' })) return;
    setError('');
    try {
      await api.deleteTemplate(t.id);
      toast.success('模板已删除');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">格式模板</h1>
          <p className="mt-1 text-sm text-slate-500">上传 .docx 模板，生成内容时按模板格式输出</p>
        </div>
        <button onClick={load} className="btn-ghost text-xs">
          <Refresh className="h-4 w-4" /> 刷新
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {/* 上传区 */}
      <div className="card mt-6 p-6">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-accent" />
          <h3 className="text-sm font-semibold text-ink">上传模板</h3>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_2fr_auto] md:items-end">
          <div>
            <label className="label">模板名称</label>
            <input
              className="input"
              placeholder="如：本科毕业论文模板"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="label">选择文件</label>
            <input
              ref={fileRef}
              type="file"
              accept=".docx"
              onChange={onFileChange}
              className="block w-full text-sm text-slate-500 file:mr-3 file:rounded-md file:border-0 file:bg-accent-50 file:px-3.5 file:py-2.5 file:text-sm file:font-medium file:text-accent hover:file:bg-accent-100"
            />
          </div>
          <button onClick={handleUpload} disabled={uploading} className="btn-primary">
            {uploading ? (
              <><Refresh className="h-4 w-4 animate-spin" /> 上传中…</>
            ) : (
              <><Plus className="h-4 w-4" /> 上传</>
            )}
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-400">仅支持 .docx 格式，模板中可预设字体、字号、行距、页边距等格式</p>
      </div>

      {/* 模板列表 */}
      <div className="mt-8 flex items-center gap-2">
        <FileWord className="h-5 w-5 text-accent" />
        <h2 className="text-sm font-semibold text-ink">模板列表</h2>
      </div>
      {loading ? (
        <div className="card mt-4 p-10 text-center text-sm text-slate-400">加载中…</div>
      ) : templates.length === 0 ? (
        <div className="card mt-4 flex flex-col items-center justify-center py-12 text-center">
          <Layers className="h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm text-slate-400">尚未上传任何模板</p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {templates.map((t) => (
            <div key={t.id} className="card p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-ink">{t.name}</h3>
                    <span className={`rounded-md px-2 py-0.5 text-xs ${t.is_global ? 'bg-accent-50 text-accent-700' : 'bg-slate-100 text-slate-600'}`}>
                      {t.is_global ? '全局' : '我的'}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">{fmtDateTime(t.created_at)}</div>
                  {Array.isArray(t.style_desc) && t.style_desc.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {t.style_desc.map((s, i) => (
                        <span key={i} className="rounded-md bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {t.is_mine && (
                  <button
                    onClick={() => handleDelete(t)}
                    className="btn-ghost flex-shrink-0 text-xs text-red-500 hover:bg-red-50"
                  >
                    <Trash className="h-3.5 w-3.5" /> 删除
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

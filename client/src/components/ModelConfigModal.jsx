import { useState } from 'react';
import { api } from '../lib/api.js';
import { toast } from './Toast.jsx';

export default function ModelConfigModal({ model, onClose, onSaved }) {
  const [form, setForm] = useState({ api_key: '', base_url: model.base_url || '', model_name: model.model_name || '', admin_password: '' });
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const save = async () => {
    setLoading(true); setError('');
    try {
      await api.adminSaveModelConfig(model.key, form);
      toast.success(`${model.name} 配置已加密保存`);
      onSaved(); onClose();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const remove = async () => {
    setLoading(true); setError('');
    try {
      await api.adminDeleteModelKey(model.key, { admin_password: form.admin_password, confirmation });
      toast.success(`${model.name} 后台 Key 已删除`);
      onSaved(); onClose();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true">
    <div className="w-full max-w-xl rounded-xl bg-white p-6 shadow-xl">
      <h2 className="text-lg font-bold text-ink">配置 {model.name}</h2>
      <p className="mt-1 text-sm text-slate-500">Key 只写入加密保险箱，保存后不会再显示。留空表示保持现有 Key。</p>
      <div className="mt-5 space-y-4">
        <div><label className="label">API Key</label><input type="password" autoComplete="new-password" className="input font-mono" disabled={model.api_key_source === 'environment'} value={form.api_key} onChange={update('api_key')} placeholder={model.api_key_source === 'environment' ? '由服务器环境变量托管，后台不可覆盖' : model.api_key_configured ? '已配置；留空保持不变' : '粘贴 API Key'} /></div>
        <div><label className="label">API Base URL</label><input className="input font-mono text-sm" value={form.base_url} onChange={update('base_url')} /></div>
        <div><label className="label">模型名称</label><input className="input font-mono text-sm" value={form.model_name} onChange={update('model_name')} /></div>
        <div><label className="label">管理员密码</label><input type="password" autoComplete="current-password" className="input" value={form.admin_password} onChange={update('admin_password')} placeholder="保存或删除前必须验证" /></div>
      </div>
      {error && <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {deleting && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4"><p className="text-sm text-red-700">删除后该模型将不可用，除非服务器环境变量仍有配置。请输入 <code>DELETE {model.key}</code>：</p><input className="input mt-2 font-mono" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /><button className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-50" disabled={loading || confirmation !== `DELETE ${model.key}` || !form.admin_password} onClick={remove}>确认删除 Key</button></div>}
      <div className="mt-6 flex flex-wrap justify-between gap-2"><div>{model.api_key_source === 'admin_vault' && !deleting && <button className="text-sm text-red-600" onClick={() => setDeleting(true)}>删除后台 Key</button>}</div><div className="flex gap-2"><button className="btn-ghost" onClick={onClose}>取消</button><button className="btn-primary" disabled={loading || !form.admin_password} onClick={save}>{loading ? '保存中…' : '加密保存'}</button></div></div>
    </div>
  </div>;
}

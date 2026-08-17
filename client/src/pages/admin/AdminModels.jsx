import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Plus, Edit, Trash, X, Check, Refresh, Shield } from '../../components/Icons.jsx';
import { toast } from '../../components/Toast.jsx';
import { useConfirm } from '../../components/ConfirmModal.jsx';

const PROVIDERS = [
  { value: 'builtin', label: '内置引擎' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'qwen', label: '通义千问' },
  { value: 'zhipu', label: '智谱' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'custom', label: '自定义' },
];

const DEFAULT_BASE_URL = {
  openai: 'https://api.openai.com/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  deepseek: 'https://api.deepseek.com/v1',
};

const emptyForm = {
  id: '',
  name: '',
  provider: 'builtin',
  base_url: '',
  api_key: '',
  model_name: '',
  temperature: 0.7,
  max_tokens: 2048,
  is_default: false,
  is_active: true,
};

export default function AdminModels() {
  const confirm = useConfirm();
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(null); // model id
  const [testResult, setTestResult] = useState({}); // { [id]: {ok, message} }

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.adminListModels();
      setModels(Array.isArray(data.models) ? data.models : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const isBuiltin = form.provider === 'builtin';

  const openCreate = () => {
    setForm({ ...emptyForm });
    setModal({ mode: 'create' });
  };

  const openEdit = (m) => {
    setForm({
      id: m.id ?? '',
      name: m.name ?? '',
      provider: m.provider ?? 'builtin',
      base_url: m.base_url ?? '',
      api_key: '',
      model_name: m.model_name ?? '',
      temperature: m.temperature ?? 0.7,
      max_tokens: m.max_tokens ?? 2048,
      is_default: !!m.is_default,
      is_active: m.is_active !== false,
    });
    setModal({ mode: 'edit' });
  };

  const close = () => {
    setModal(null);
    setForm(emptyForm);
  };

  const changeProvider = (provider) => {
    const builtin = provider === 'builtin';
    setForm((prev) => ({
      ...prev,
      provider,
      base_url: builtin ? '' : prev.base_url || DEFAULT_BASE_URL[provider] || '',
      api_key: builtin ? '' : prev.api_key,
    }));
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: form.name,
        provider: form.provider,
        base_url: isBuiltin ? '' : form.base_url,
        model_name: form.model_name,
        temperature: Number(form.temperature) || 0.7,
        max_tokens: Number(form.max_tokens) || 2048,
        is_default: !!form.is_default,
        is_active: !!form.is_active,
      };
      if (!isBuiltin && form.api_key) payload.api_key = form.api_key;
      if (modal.mode === 'create') {
        await api.adminCreateModel(payload);
      } else {
        await api.adminUpdateModel(form.id, payload);
      }
      toast.success('模型已保存');
      close();
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (m) => {
    if (!await confirm({
      title: '删除确认',
      message: `确认删除「${m.name}」？此操作不可撤销。`,
      danger: true,
      confirmText: '删除',
    })) return;
    setError('');
    try {
      await api.adminDeleteModel(m.id);
      toast.success('模型已删除');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const setDefault = async (m) => {
    setError('');
    try {
      await api.adminUpdateModel(m.id, { is_default: true });
      toast.success('已设为默认模型');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const test = async (m) => {
    setTesting(m.id);
    setError('');
    try {
      const data = await api.adminTestModel(m.id);
      setTestResult({ ...testResult, [m.id]: { ok: true, message: data.message || '连接成功' } });
    } catch (err) {
      setTestResult({ ...testResult, [m.id]: { ok: false, message: err.message } });
    } finally {
      setTesting(null);
    }
  };

  const providerLabel = (v) => PROVIDERS.find((p) => p.value === v)?.label || v;

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">模型配置</h1>
          <p className="mt-1 text-sm text-slate-500">配置 AI 模型接入与默认模型</p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="h-4 w-4" />
          新增模型
        </button>
      </div>

      {/* 提示横幅 */}
      <div className="mt-4 rounded-lg bg-accent-50 p-4 text-sm text-accent">
        配置 OpenAI 兼容接口后，所有 AI 工具将使用真实模型；未配置或保留内置引擎时使用模板模拟。支持 OpenAI / 通义千问 / 智谱 / DeepSeek / 自定义等任何兼容接口。
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {loading ? (
        <div className="mt-6 text-sm text-slate-400">加载中…</div>
      ) : (
        <div className="mt-6 space-y-4">
          {models.length === 0 && (
            <div className="card flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                <Shield className="h-6 w-6" />
              </div>
              <p className="mt-3 text-sm text-slate-500">还没有配置模型</p>
              <button onClick={openCreate} className="btn-ghost mt-3 text-xs">
                <Plus className="h-4 w-4" /> 新增第一个模型
              </button>
            </div>
          )}
          {models.map((m) => {
            const tr = testResult[m.id];
            return (
              <div key={m.id} className="card p-5">
                <div className="flex items-start justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-ink">{m.name}</h3>
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {providerLabel(m.provider)}
                    </span>
                    {m.is_default && (
                      <span className="rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-white">默认</span>
                    )}
                    <span className={`rounded-md px-2 py-0.5 text-xs ${m.is_active !== false ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                      {m.is_active !== false ? '启用' : '停用'}
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <div className="flex">
                    <span className="w-24 flex-shrink-0 text-slate-400">模型名</span>
                    <span className="truncate font-mono text-xs text-slate-700">{m.model_name || '—'}</span>
                  </div>
                  <div className="flex">
                    <span className="w-24 flex-shrink-0 text-slate-400">接口地址</span>
                    <span className="truncate font-mono text-xs text-slate-700">{m.base_url || '—'}</span>
                  </div>
                  <div className="flex">
                    <span className="w-24 flex-shrink-0 text-slate-400">API Key</span>
                    <span className="truncate font-mono text-xs text-slate-700">{m.api_key_masked || m.api_key_mask || '—'}</span>
                  </div>
                  <div className="flex">
                    <span className="w-24 flex-shrink-0 text-slate-400">参数</span>
                    <span className="text-xs text-slate-700">temp {m.temperature} · tokens {m.max_tokens}</span>
                  </div>
                </div>

                {tr && (
                  <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${tr.ok ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                    {tr.ok ? '✓ ' : '✗ '}{tr.message}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                  <button onClick={() => test(m)} disabled={testing === m.id} className="btn-secondary text-xs">
                    <Refresh className={`h-4 w-4 ${testing === m.id ? 'animate-spin' : ''}`} />
                    {testing === m.id ? '测试中…' : '测试连接'}
                  </button>
                  <button onClick={() => openEdit(m)} className="btn-ghost text-xs">
                    <Edit className="h-4 w-4" /> 编辑
                  </button>
                  {!m.is_default && (
                    <button onClick={() => setDefault(m)} className="btn-ghost text-xs">
                      <Check className="h-4 w-4" /> 设为默认
                    </button>
                  )}
                  <button onClick={() => remove(m)} className="btn-ghost text-xs text-red-500 hover:bg-red-50">
                    <Trash className="h-4 w-4" /> 删除
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-[520px] max-w-full rounded-xl bg-white shadow-card">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="text-base font-semibold text-ink">
                {modal.mode === 'create' ? '新增模型' : '编辑模型'}
              </h3>
              <button onClick={close} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-ink">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">名称</label>
                  <input
                    className="input"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="如 主力模型"
                  />
                </div>
                <div>
                  <label className="label">服务商</label>
                  <select
                    className="input"
                    value={form.provider}
                    onChange={(e) => changeProvider(e.target.value)}
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">接口地址 (Base URL)</label>
                <input
                  className="input"
                  value={form.base_url}
                  onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                  disabled={isBuiltin}
                  placeholder={DEFAULT_BASE_URL[form.provider] || 'https://api.openai.com/v1'}
                />
              </div>
              <div>
                <label className="label">API Key</label>
                <input
                  type="password"
                  className="input"
                  value={form.api_key}
                  onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                  disabled={isBuiltin}
                  placeholder={modal.mode === 'edit' ? '留空不修改' : 'sk-...'}
                />
              </div>
              <div>
                <label className="label">模型名</label>
                <input
                  className="input"
                  value={form.model_name}
                  onChange={(e) => setForm({ ...form, model_name: e.target.value })}
                  placeholder="如 gpt-4o-mini"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Temperature</label>
                  <input
                    type="number"
                    step="0.1"
                    className="input"
                    value={form.temperature}
                    onChange={(e) => setForm({ ...form, temperature: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Max Tokens</label>
                  <input
                    type="number"
                    className="input"
                    value={form.max_tokens}
                    onChange={(e) => setForm({ ...form, max_tokens: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent"
                    checked={form.is_default}
                    onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
                  />
                  设为默认模型
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent"
                    checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  />
                  启用
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button onClick={close} className="btn-secondary">取消</button>
              <button onClick={save} disabled={saving} className="btn-primary">
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Check, Refresh, Shield, Info, Cpu } from '../../components/Icons.jsx';
import { toast } from '../../components/Toast.jsx';

const PROVIDER_LABELS = {
  deepseek: 'DeepSeek',
  qwen: '通义千问',
  zhipu: '智谱 GLM',
  moonshot: 'Kimi（月之暗面）',
  openai: 'OpenAI',
};

export default function AdminModels() {
  const [models, setModels] = useState([]);
  const [roleRouting, setRoleRouting] = useState({});
  const [savingRoles, setSavingRoles] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [setting, setSetting] = useState(null); // 正在设为默认的模型 key
  const [testing, setTesting] = useState(null); // 正在测试连接的模型 key
  const [testResult, setTestResult] = useState({}); // { [key]: {ok, message} }

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.adminListModels();
      setModels(Array.isArray(data.models) ? data.models : []);
      setRoleRouting(data.roleRouting || {});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setDefault = async (m) => {
    setSetting(m.key);
    setError('');
    try {
      await api.adminSetDefaultModel(m.key);
      toast.success(`已将默认模型切换为「${m.name}」`);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSetting(null);
    }
  };

  const test = async (m) => {
    setTesting(m.key);
    setError('');
    try {
      const data = await api.adminTestModel(m.key);
      setTestResult({ ...testResult, [m.key]: { ok: !!data.ok, message: data.message || '连接成功' } });
    } catch (err) {
      setTestResult({ ...testResult, [m.key]: { ok: false, message: err.message } });
    } finally {
      setTesting(null);
    }
  };

  const providerLabel = (v) => PROVIDER_LABELS[v] || v;

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">模型配置</h1>
          <p className="mt-1 text-sm text-slate-500">选择默认 AI 模型，API Key 通过环境变量注入，不在系统内保存</p>
        </div>
      </div>

      {/* 安全设计提示 */}
      <div className="mt-4 rounded-lg border border-accent/20 bg-accent-50 p-4 text-sm text-accent">
        <div className="flex items-start gap-2">
          <Shield className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <p className="font-medium">API Key 安全设计：不在系统中录入或存储 Key</p>
            <p className="mt-1 leading-relaxed">
              每个模型的 API Key 通过服务器环境变量 <code className="rounded bg-white/60 px-1 font-mono text-xs">LLM_API_KEY_&lt;KEY&gt;</code>{' '}
              注入（如 <code className="rounded bg-white/60 px-1 font-mono text-xs">LLM_API_KEY_DEEPSEEK</code>），
              不写入数据库、不返回给前端，降低数据库泄露或前端暴露带来的风险。仍需妥善保护服务器环境变量。
            </p>
            <p className="mt-1 leading-relaxed">
              后续新增模型：只需在服务端 <code className="rounded bg-white/60 px-1 font-mono text-xs">model-catalog.js</code>{' '}
              追加一条预设并配置对应环境变量，本页面会自动展示，无需其他改动。
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      <section className="card mt-6 p-5">
        <h2 className="font-semibold">按学科配置写作与独立审校</h2>
        <p className="mt-1 text-sm text-slate-500">未指定主写模型时使用默认模型；自动审校使用另一已配置模型，没有第二个模型时跳过。请依据你自己的学科样例评测选择，系统不预设某家模型一定更强。</p>
        <div className="mt-4 space-y-3">
          {[['general','通用'],['technical','理工科'],['social','人文社科']].map(([group,label]) => <div key={group} className="grid items-center gap-2 sm:grid-cols-3">
            <span className="text-sm">{label}</span>
            {['writer','reviewer'].map(role => <select key={role} aria-label={`${label}${role === 'writer' ? '主写' : '审校'}模型`} className="input text-sm" value={roleRouting[group]?.[role] || ''} onChange={e => setRoleRouting(r => ({...r,[group]:{...r[group],[role]:e.target.value}}))}>
              <option value="">{role === 'writer' ? '默认主写模型' : '自动选择独立审校'}</option>
              {role === 'reviewer' && <option value="off">关闭模型审校（保留规则检查）</option>}
              {models.filter(m => m.api_key_configured || m.key === roleRouting[group]?.[role]).map(m => <option key={m.key} value={m.key}>{m.name}{m.api_key_configured ? '' : '（未配置，运行时回退）'}</option>)}
            </select>)}
          </div>)}
        </div>
        <button className="btn-primary mt-4" disabled={savingRoles || loading} onClick={async () => { setSavingRoles(true); try { const d = await api.adminSaveModelRoles(roleRouting); setRoleRouting(d.roleRouting); toast.success('角色分工已保存'); } catch(err) { toast.error(err.message); } finally { setSavingRoles(false); } }}>{savingRoles ? '保存中…' : '保存角色分工'}</button>
      </section>

      {loading ? (
        <div className="mt-6 text-sm text-slate-400">加载中…</div>
      ) : (
        <div className="mt-6 space-y-4">
          {models.length === 0 && (
            <div className="card flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                <Cpu className="h-6 w-6" />
              </div>
              <p className="mt-3 text-sm text-slate-500">暂无可用模型预设</p>
            </div>
          )}
          {models.map((m) => {
            const configured = !!m.api_key_configured;
            const isDefault = !!m.is_default;
            const tr = testResult[m.key];
            return (
              <div key={m.key} className="card p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-ink">{m.name}</h3>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {providerLabel(m.provider)}
                  </span>
                  {isDefault && (
                    <span className="rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-white">默认模型</span>
                  )}
                  <span className={`rounded-md px-2 py-0.5 text-xs ${configured ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>
                    {configured ? '已配置 Key' : '未配置 Key'}
                  </span>
                </div>

                <div className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <div className="flex">
                    <span className="w-24 flex-shrink-0 text-slate-400">模型名</span>
                    <span className="truncate font-mono text-xs text-slate-700">{m.model_name}</span>
                  </div>
                  <div className="flex">
                    <span className="w-24 flex-shrink-0 text-slate-400">接口地址</span>
                    <span className="truncate font-mono text-xs text-slate-700">{m.base_url}</span>
                  </div>
                  <div className="flex sm:col-span-2">
                    <span className="w-24 flex-shrink-0 text-slate-400">API Key</span>
                    <span className="text-xs text-slate-700">{m.api_key_masked || (configured ? '已配置' : '未配置')}</span>
                  </div>
                </div>

                {tr && (
                  <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${tr.ok ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                    {tr.ok ? '✓ ' : '✗ '}{tr.message}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                  <button
                    onClick={() => test(m)}
                    disabled={testing === m.key}
                    className="btn-secondary text-xs"
                  >
                    <Refresh className={`h-4 w-4 ${testing === m.key ? 'animate-spin' : ''}`} />
                    {testing === m.key ? '测试中…' : '测试连接'}
                  </button>
                  {!isDefault && (
                    <button
                      onClick={() => setDefault(m)}
                      disabled={setting === m.key}
                      className="btn-ghost text-xs"
                      title={configured ? '' : '需先配置对应环境变量 Key 才能设为默认'}
                    >
                      <Check className="h-4 w-4" />
                      {setting === m.key ? '设置中…' : '设为默认'}
                    </button>
                  )}
                  {!configured && (
                    <span className="flex items-center gap-1 text-xs text-slate-400">
                      <Info className="h-3.5 w-3.5" />
                      需在服务器环境变量中配置 {m.env_key}
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          <div className="rounded-lg bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-500">
            请至少配置一个可用写作模型。开发环境可用模板演示流程；生产环境的完整论文正文不会以演示模板代替真实模型交付。
          </div>
        </div>
      )}
    </div>
  );
}

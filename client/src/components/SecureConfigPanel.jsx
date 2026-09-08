import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { toast } from './Toast.jsx';

const DEFINITIONS = {
  alert_webhook_url: { label: '错误告警 Webhook', placeholder: 'https://example.com/alert-hook', help: '服务端错误会脱敏、去重后发送到该地址。' },
  totp_encryption_key: { label: '后台 2FA 加密密钥', placeholder: '至少 32 字符', help: '用于加密管理员和客服的 TOTP 密钥；已有账号启用 2FA 后禁止轮换或删除。' },
};

export default function SecureConfigPanel() {
  const [items, setItems] = useState([]);
  const [values, setValues] = useState({});
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState({});
  const [busy, setBusy] = useState('');
  const load = async () => { const data = await api.adminGetSecureConfig(); setItems(data.items || []); };
  useEffect(() => { load().catch((err) => toast.error(err.message)); }, []);
  const save = async (key) => {
    setBusy(key);
    try { await api.adminSaveSecureConfig(key, { value: values[key], admin_password: password }); setValues({ ...values, [key]: '' }); toast.success('密钥已加密保存'); await load(); }
    catch (err) { toast.error(err.message); }
    finally { setBusy(''); }
  };
  const remove = async (key) => {
    setBusy(key);
    try { await api.adminDeleteSecureConfig(key, { admin_password: password, confirmation: confirmation[key] }); toast.success('后台密钥已删除'); await load(); }
    catch (err) { toast.error(err.message); }
    finally { setBusy(''); }
  };
  const generateTotpKey = () => {
    const bytes = new Uint8Array(32); window.crypto.getRandomValues(bytes);
    setValues({ ...values, totp_encryption_key: Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('') });
  };
  return <div className="card p-6">
    <h3 className="text-sm font-semibold text-ink">运行密钥保险箱</h3>
    <p className="mt-1 text-xs leading-5 text-slate-500">仅管理员可访问。已保存值永不回显；空输入不会覆盖。环境变量托管的值优先级更高，后台不能修改或删除。</p>
    <div className="mt-4 space-y-5">{items.map((item) => {
      const def = DEFINITIONS[item.key];
      const deletable = item.configured && item.source === 'admin_vault';
      return <div key={item.key} className="rounded-lg border border-slate-200 p-4">
        <div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium text-ink">{def.label}</div><p className="mt-1 text-xs text-slate-400">{def.help}</p></div><span className={`whitespace-nowrap rounded px-2 py-1 text-xs ${item.configured ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>{item.configured ? (item.source === 'environment' ? '环境变量托管' : '已加密配置') : '未配置'}</span></div>
        <div className="mt-3 flex gap-2"><input type="password" className="input flex-1 font-mono" disabled={item.source === 'environment'} placeholder={item.configured ? '已配置；输入新值才会替换' : def.placeholder} value={values[item.key] || ''} onChange={(e) => setValues({ ...values, [item.key]: e.target.value })} />{item.key === 'totp_encryption_key' && item.source !== 'environment' && <button className="btn-secondary whitespace-nowrap" onClick={generateTotpKey}>安全生成</button>}<button className="btn-primary whitespace-nowrap" disabled={busy || item.source === 'environment' || !values[item.key] || !password} onClick={() => save(item.key)}>{busy === item.key ? '保存中…' : '保存'}</button></div>
        {deletable && <details className="mt-3"><summary className="cursor-pointer text-xs text-red-600">删除此后台配置</summary><div className="mt-2 flex gap-2"><input className="input flex-1 font-mono text-xs" placeholder={`输入 DELETE ${item.key}`} value={confirmation[item.key] || ''} onChange={(e) => setConfirmation({ ...confirmation, [item.key]: e.target.value })} /><button className="rounded-lg bg-red-600 px-3 py-2 text-xs text-white disabled:opacity-50" disabled={busy || !password || confirmation[item.key] !== `DELETE ${item.key}`} onClick={() => remove(item.key)}>确认删除</button></div></details>}
      </div>;
    })}</div>
    <div className="mt-4"><label className="label">管理员密码（二次确认）</label><input type="password" autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="保存或删除密钥前必须输入" /></div>
  </div>;
}

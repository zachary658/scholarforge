import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

export default function TwoFactorModal({ onClose }) {
  const { user, clearSession } = useAuth();
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const begin = async () => {
    setLoading(true); setError('');
    try { setSetup(await api.setupTwoFactor(password)); } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const confirm = async () => {
    setLoading(true); setError('');
    try {
      const data = await api.confirmTwoFactor(code.trim());
      setRecoveryCodes(data.recovery_codes || []);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const disable = async () => {
    setLoading(true); setError('');
    try {
      await api.disableTwoFactor({ password, code: code.trim() });
      clearSession();
      window.location.href = '/login';
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const close = () => {
    if (recoveryCodes.length) {
      clearSession();
      window.location.href = '/login';
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-ink">双因素认证</h2>
        {!user?.two_factor_enabled && !setup && !recoveryCodes.length && (
          <>
            <p className="mt-2 text-sm text-slate-500">启用后，登录后台还需要身份验证器中的动态验证码，可显著降低密码泄露风险。</p>
            <input type="password" className="input mt-4" placeholder="输入当前密码确认本人操作" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button className="btn-primary mt-5" disabled={loading || !password} onClick={begin}>{loading ? '准备中…' : '开始设置'}</button>
          </>
        )}
        {setup && !recoveryCodes.length && (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-slate-600">在 Microsoft Authenticator、Google Authenticator 或其他 TOTP 应用中选择“手动输入密钥”。</p>
            <div className="rounded-lg bg-slate-50 p-3 font-mono text-sm break-all select-all">{setup.secret}</div>
            <div>
              <label className="label">输入应用显示的 6 位验证码</label>
              <input className="input font-mono tracking-[0.2em]" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <button className="btn-primary" disabled={loading || !/^\d{6}$/.test(code.trim())} onClick={confirm}>{loading ? '验证中…' : '验证并启用'}</button>
          </div>
        )}
        {recoveryCodes.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-medium text-red-600">请立即保存恢复码。每个恢复码只能使用一次，关闭后不会再次显示。</p>
            <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-4 font-mono text-sm">
              {recoveryCodes.map((item) => <span key={item} className="select-all">{item}</span>)}
            </div>
          </div>
        )}
        {user?.two_factor_enabled && !recoveryCodes.length && (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-slate-600">双因素认证已启用。关闭前需要再次验证密码和动态验证码（或未使用的恢复码）。</p>
            <input type="password" className="input" placeholder="当前密码" value={password} onChange={(e) => setPassword(e.target.value)} />
            <input className="input font-mono" placeholder="动态验证码或恢复码" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={loading || !password || !code} onClick={disable}>{loading ? '关闭中…' : '关闭双因素认证'}</button>
          </div>
        )}
        {error && <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
        <div className="mt-6 flex justify-end"><button className="btn-ghost" onClick={close}>{recoveryCodes.length ? '我已保存，重新登录' : '关闭'}</button></div>
      </div>
    </div>
  );
}

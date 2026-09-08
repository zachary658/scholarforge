import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { toast } from './Toast.jsx';

export default function EmailVerificationBanner() {
  const { user, updateUser } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  if (!user || user.email_verified || user.is_admin || user.is_support) return null;

  const verify = async () => {
    if (!/^\d{6}$/.test(code)) return toast.warning('请输入邮件中的6位验证码');
    setBusy(true);
    try {
      await api.verifyEmail(code);
      updateUser({ email_verified: true });
      toast.success('邮箱验证成功，现在可以正常下单');
    } catch (error) { toast.error(error.message); }
    finally { setBusy(false); }
  };

  const resend = async () => {
    setBusy(true);
    try { await api.sendEmailVerification(); toast.success('验证邮件已重新发送'); }
    catch (error) { toast.error(error.message); }
    finally { setBusy(false); }
  };

  return <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
    <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-2">
      <span>请验证邮箱 {user.email}，验证后才可创建付费订单。</span>
      <input aria-label="邮箱验证码" className="h-8 w-28 rounded-md border border-amber-300 bg-white px-2 tracking-widest" inputMode="numeric" maxLength="6" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} placeholder="6位验证码" />
      <button className="rounded-md bg-amber-700 px-3 py-1.5 text-white disabled:opacity-50" disabled={busy} onClick={verify}>验证</button>
      <button className="px-2 py-1 text-amber-800 underline disabled:opacity-50" disabled={busy} onClick={resend}>重新发送</button>
    </div>
  </div>;
}

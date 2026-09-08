import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { toast } from './Toast.jsx';

export default function EmailConfigPanel() {
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState({ smtp_url: '', mail_from: '', frontend_url: '', admin_password: '' });
  const [testTo, setTestTo] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState('');

  const load = async () => {
    const data = await api.adminGetEmailConfig();
    setStatus(data);
    setForm((current) => ({ ...current, smtp_url: '', mail_from: data.mail_from || '', frontend_url: data.frontend_url || '' }));
  };
  useEffect(() => { load().catch((err) => toast.error(err.message)); }, []);
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const save = async () => {
    setBusy('save');
    try {
      await api.adminSaveEmailConfig({
        smtp_url: form.smtp_url,
        mail_from: status?.mail_from_source === 'environment' ? '' : form.mail_from,
        frontend_url: status?.frontend_url_source === 'environment' ? '' : form.frontend_url,
        admin_password: form.admin_password,
      });
      toast.success('邮件验证服务配置已保存');
      await load();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(''); }
  };

  const sendTest = async () => {
    setBusy('test');
    try {
      await api.adminTestEmailConfig({ to: testTo, admin_password: form.admin_password });
      toast.success('测试邮件已发送，请检查收件箱和垃圾邮件目录');
    } catch (err) { toast.error(err.message); }
    finally { setBusy(''); }
  };

  const remove = async () => {
    setBusy('delete');
    try {
      await api.adminDeleteSmtpConfig({ confirmation, admin_password: form.admin_password });
      setConfirmation('');
      toast.success('后台 SMTP 配置已删除');
      await load();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(''); }
  };

  if (!status) return <div className="card p-6 text-sm text-slate-400">正在加载邮件配置…</div>;
  const smtpFromEnv = status.smtp_source === 'environment';
  const hasEditableValues = (!smtpFromEnv && form.smtp_url)
    || (status.mail_from_source !== 'environment' && form.mail_from)
    || (status.frontend_url_source !== 'environment' && form.frontend_url);
  return <div className="card p-6">
    <div className="flex items-start justify-between gap-3">
      <div><h3 className="text-sm font-semibold text-ink">邮件验证服务</h3><p className="mt-1 text-xs leading-5 text-slate-500">用于注册验证码、密码重置和项目通知。SMTP 连接串包含账号密码，将加密保存且永不回显。</p></div>
      <span className={`whitespace-nowrap rounded px-2 py-1 text-xs ${status.configured ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>{status.configured ? (smtpFromEnv ? '环境变量托管' : '已加密配置') : '未配置'}</span>
    </div>
    <div className="mt-4 space-y-4">
      <div><label className="label">SMTP 连接串</label><input type="password" autoComplete="new-password" className="input font-mono text-sm" disabled={smtpFromEnv} value={form.smtp_url} onChange={update('smtp_url')} placeholder={smtpFromEnv ? '由 SMTP_URL 环境变量托管' : status.configured ? '已配置；留空保持不变' : 'smtps://用户名:密码@smtp.example.com:465'} /><p className="mt-1 text-xs text-slate-400">支持 smtp:// 和 smtps://；用户名或密码含特殊字符时请进行 URL 编码。</p></div>
      <div className="grid gap-4 md:grid-cols-2">
        <div><label className="label">发件人</label><input className="input" disabled={status.mail_from_source === 'environment'} value={form.mail_from} onChange={update('mail_from')} placeholder="ScholarForge <noreply@example.com>" /></div>
        <div><label className="label">用户访问地址</label><input className="input" disabled={status.frontend_url_source === 'environment'} value={form.frontend_url} onChange={update('frontend_url')} placeholder="https://your-domain.example" /><p className="mt-1 text-xs text-slate-400">用于密码重置邮件中的跳转链接。</p></div>
      </div>
      <div><label className="label">管理员密码（二次确认）</label><input type="password" autoComplete="current-password" className="input" value={form.admin_password} onChange={update('admin_password')} placeholder="保存、测试或删除前必须输入" /></div>
      <div className="flex justify-end"><button className="btn-primary" disabled={busy || !form.admin_password || !hasEditableValues} onClick={save}>{busy === 'save' ? '保存中…' : '保存邮件配置'}</button></div>
    </div>
    {status.configured && <div className="mt-5 rounded-lg border border-slate-200 p-4"><div className="text-sm font-medium text-ink">发送测试邮件</div><div className="mt-2 flex gap-2"><input type="email" className="input flex-1" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="QQ 邮箱或 163 邮箱" /><button className="btn-secondary whitespace-nowrap" disabled={busy || !form.admin_password || !testTo} onClick={sendTest}>{busy === 'test' ? '发送中…' : '发送测试'}</button></div></div>}
    {status.smtp_source === 'admin_vault' && <details className="mt-4"><summary className="cursor-pointer text-xs text-red-600">删除 SMTP 配置</summary><div className="mt-2 flex gap-2"><input className="input flex-1 font-mono text-xs" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder="输入 DELETE SMTP" /><button className="rounded-lg bg-red-600 px-3 py-2 text-xs text-white disabled:opacity-50" disabled={busy || !form.admin_password || confirmation !== 'DELETE SMTP'} onClick={remove}>确认删除</button></div></details>}
  </div>;
}

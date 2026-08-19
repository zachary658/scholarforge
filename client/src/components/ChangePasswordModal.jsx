import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { toast } from './Toast.jsx';
import { Lock, X } from './Icons.jsx';

// 修改密码弹窗：需校验当前密码，修改成功后吊销所有会话并跳转登录页
export default function ChangePasswordModal({ onClose }) {
  const navigate = useNavigate();
  const { clearSession } = useAuth();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const update = (key) => (e) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
    if (error) setError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.current) { setError('请输入当前密码'); return; }
    if (form.next.length < 8 || !/[a-zA-Z]/.test(form.next) || !/\d/.test(form.next)) {
      setError('新密码至少 8 位，且必须同时包含字母和数字');
      return;
    }
    if (form.next === form.current) { setError('新密码不能与当前密码相同'); return; }
    if (form.next !== form.confirm) { setError('两次输入的新密码不一致'); return; }
    setLoading(true);
    try {
      await api.changePassword({ current_password: form.current, new_password: form.next });
      toast.success('密码修改成功，请重新登录');
      clearSession();
      onClose();
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err.message || '修改失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[400px] max-w-full rounded-xl bg-white shadow-card">
        <div className="flex items-start gap-3 p-6">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent-50 text-accent">
            <Lock className="h-5 w-5" />
          </div>
          <div className="flex-1 pt-0.5">
            <h3 className="text-base font-semibold text-ink">修改密码</h3>
            <p className="mt-1 text-sm text-slate-500">为保障账号安全，修改后所有设备将退出登录</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 px-6 pb-6">
          <div>
            <label className="label">当前密码</label>
            <input
              type="password"
              className="input"
              placeholder="请输入当前密码"
              value={form.current}
              onChange={update('current')}
              autoFocus
              required
            />
          </div>
          <div>
            <label className="label">新密码</label>
            <input
              type="password"
              className="input"
              placeholder="至少 8 位，含字母和数字"
              value={form.next}
              onChange={update('next')}
              required
            />
          </div>
          <div>
            <label className="label">确认新密码</label>
            <input
              type="password"
              className="input"
              placeholder="再次输入新密码"
              value={form.confirm}
              onChange={update('confirm')}
              required
            />
          </div>
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary">
              取消
            </button>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? '提交中…' : '确认修改'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

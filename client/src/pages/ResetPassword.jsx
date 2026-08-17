import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Logo, ArrowRight } from '../components/Icons.jsx';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm] = useState({
    token: params.get('token') || '',
    password: '',
    confirm: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.token) {
      setError('重置令牌缺失，请通过邮件中的链接进入');
      return;
    }
    if (form.password.length < 8) {
      setError('密码至少 8 位');
      return;
    }
    if (!/[a-zA-Z]/.test(form.password) || !/\d/.test(form.password)) {
      setError('密码必须同时包含字母和数字');
      return;
    }
    if (form.password !== form.confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setLoading(true);
    try {
      await api.resetPassword({ token: form.token, password: form.password });
      setDone(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2.5">
          <Logo className="h-9 w-9" />
          <span className="text-lg font-bold text-ink">ScholarForge</span>
        </Link>
        <div className="card p-8">
          <h1 className="text-xl font-bold text-ink">重置密码</h1>
          <p className="mt-1 text-sm text-slate-500">设置新的登录密码</p>
          {done ? (
            <div className="mt-6 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
              密码重置成功，即将跳转到登录页…
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <div>
                <label className="label">新密码</label>
                <input
                  type="password"
                  className="input"
                  placeholder="至少 8 位，含字母和数字"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label">确认密码</label>
                <input
                  type="password"
                  className="input"
                  placeholder="再次输入新密码"
                  value={form.confirm}
                  onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                  required
                />
              </div>
              {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
              <button type="submit" disabled={loading} className="btn-primary w-full py-3">
                {loading ? '提交中…' : '重置密码'}
                {!loading && <ArrowRight className="h-4 w-4" />}
              </button>
            </form>
          )}
          <p className="mt-6 text-center text-sm text-slate-500">
            想起密码了？{' '}
            <Link to="/login" className="font-medium text-accent hover:underline">
              返回登录
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

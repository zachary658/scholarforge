import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Logo, ArrowRight } from '../components/Icons.jsx';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) {
      setError('请填写邮箱');
      return;
    }
    setLoading(true);
    try {
      await api.forgotPassword(email.trim());
      setDone(true);
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
          <h1 className="text-xl font-bold text-ink">找回密码</h1>
          <p className="mt-1 text-sm text-slate-500">输入注册邮箱，我们将发送重置链接</p>
          {done ? (
            <div className="mt-6 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
              若该邮箱已注册，重置链接已发送至邮箱，请注意查收（可能在垃圾邮件箱）。
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <div>
                <label className="label">邮箱</label>
                <input
                  type="email"
                  className="input"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
              <button type="submit" disabled={loading} className="btn-primary w-full py-3">
                {loading ? '发送中…' : '发送重置链接'}
                {!loading && <ArrowRight className="h-4 w-4" />}
              </button>
            </form>
          )}
          <p className="mt-6 text-center text-sm text-slate-500">
            <Link to="/login" className="font-medium text-accent hover:underline">
              返回登录
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

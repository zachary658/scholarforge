import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { Logo, ArrowRight } from '../components/Icons.jsx';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const update = (key) => (e) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
    if (error) setError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    const email = form.email.trim();
    const password = form.password;
    if (!email) { setError('请输入邮箱'); return; }
    if (!EMAIL_RE.test(email)) { setError('邮箱格式不正确'); return; }
    if (!password) { setError('请输入密码'); return; }
    setError('');
    setLoading(true);
    try {
      const user = await login({ email, password });
      const redirect = params.get('redirect');
      if (redirect) {
        navigate(redirect);
      } else if (user.is_admin) {
        navigate('/admin');
      } else if (user.is_support) {
        navigate('/support');
      } else {
        navigate('/app');
      }
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
          <h1 className="text-xl font-bold text-ink">欢迎回来</h1>
          <p className="mt-1 text-sm text-slate-500">登录以继续使用学术写作工具</p>
          <form onSubmit={submit} noValidate className="mt-6 space-y-4">
            <div>
              <label className="label">邮箱</label>
              <input
                type="email"
                className="input"
                placeholder="you@example.com"
                value={form.email}
                onChange={update('email')}
                disabled={loading}
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="label">密码</label>
                <Link to="/forgot-password" className="text-xs font-medium text-accent hover:underline">
                  忘记密码？
                </Link>
              </div>
              <input
                type="password"
                className="input"
                placeholder="请输入密码"
                value={form.password}
                onChange={update('password')}
                disabled={loading}
              />
            </div>
            {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
            <button type="submit" disabled={loading} className="btn-primary w-full py-3">
              {loading ? '登录中…' : '登录'}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-slate-500">
            还没有账号？{' '}
            <Link to="/register" className="font-medium text-accent hover:underline">
              立即注册
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { getDeviceFingerprint } from '../lib/device-fingerprint.js';
import { Logo, ArrowRight, Check } from '../components/Icons.jsx';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!agree) {
      setError('请先阅读并勾选同意《用户需知》');
      return;
    }
    // 密码强度校验：与后端/重置密码页一致（至少 8 位且含字母和数字）
    if (form.password.length < 8 || !/[a-zA-Z]/.test(form.password) || !/\d/.test(form.password)) {
      setError('密码至少 8 位，且必须同时包含字母和数字');
      return;
    }
    setLoading(true);
    try {
      await register({ ...form, device_fingerprint: getDeviceFingerprint(), agree_terms: true });
      navigate('/app');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card md:grid-cols-2">
        {/* 左侧介绍 */}
        <div className="hidden flex-col justify-between bg-ink p-10 text-white md:flex">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo className="h-8 w-8" />
            <span className="text-lg font-bold">ScholarForge</span>
          </Link>
          <div>
            <h2 className="text-2xl font-bold leading-snug">按需付费<br />学术辅助</h2>
            <ul className="mt-6 space-y-3 text-sm text-slate-300">
              {['AI 论文大纲与全文生成', '学术润色与中英翻译', '文献检索与格式化导出', '固定价格与人工报价，灵活透明'].map((t) => (
                <li key={t} className="flex items-center gap-2.5">
                  <Check className="h-4 w-4 text-accent" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-slate-400">© 2026 ScholarForge</p>
        </div>

        {/* 右侧表单 */}
        <div className="p-8 md:p-10">
          <h1 className="text-xl font-bold text-ink">创建账号</h1>
          <p className="mt-1 text-sm text-slate-500">填写信息，创建账号</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="label">昵称</label>
              <input
                className="input"
                placeholder="你的昵称"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">邮箱</label>
              <input
                type="email"
                className="input"
                placeholder="you@example.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">密码</label>
              <input
                type="password"
                className="input"
                placeholder="至少 8 位，含字母和数字"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </div>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-relaxed text-slate-600">
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
                required
                className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
              />
              <span>
                我已阅读并同意
                <Link to="/terms" className="font-medium text-accent hover:underline">《用户协议》</Link>
                与
                <Link to="/privacy" className="font-medium text-accent hover:underline">《隐私政策》</Link>
                ：本平台由 AI 生成的文字、文档、图表等所有内容
                <strong className="font-semibold text-ink">仅供学习参考</strong>，不构成学术成果或建议，
                <strong className="font-semibold text-ink">不得直接用于</strong>论文写作、作业提交、考试、投稿、查重等
                <strong className="font-semibold text-ink">任何学术场景</strong>；因违规使用产生的一切后果由本人自行承担。
              </span>
            </label>
            {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
            <button type="submit" disabled={loading} className="btn-primary w-full py-3">
              {loading ? '注册中…' : '注册'}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-slate-500">
            已有账号？{' '}
            <Link to="/login" className="font-medium text-accent hover:underline">
              直接登录
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

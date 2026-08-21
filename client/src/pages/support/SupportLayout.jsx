import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth.jsx';
import { Wechat, BookOpen, Cpu, Grid, Logout, Menu, X, ArrowRight, Lock, Shield, Book } from '../../components/Icons.jsx';
import ChangePasswordModal from '../../components/ChangePasswordModal.jsx';

const nav = [
  { to: '/support', label: '工作台', icon: Grid, end: true },
  { to: '/support/orders', label: '课程对接', icon: Wechat, end: false },
  { to: '/support/courses', label: '课程列表', icon: BookOpen, end: false },
  { to: '/support/graduation', label: '毕业作品', icon: Cpu, end: false },
  { to: '/support/patent', label: '专利申请', icon: Shield, end: false },
  { to: '/support/publication', label: '期刊发表', icon: Book, end: false },
];

export default function SupportLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [changePwdOpen, setChangePwdOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  useEffect(() => {
    const handler = () => setSidebarOpen(false);
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    if (sidebarOpen) {
      document.addEventListener('keydown', handler);
      return () => document.removeEventListener('keydown', handler);
    }
  }, [sidebarOpen]);

  const sidebar = (
    <aside className="flex h-full w-64 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-50 text-green-600">
          <Wechat className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-bold text-ink">ScholarForge</div>
          <div className="text-[11px] text-slate-400">客服工作台</div>
        </div>
        <button
          onClick={() => setSidebarOpen(false)}
          className="ml-auto rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-ink md:hidden"
          aria-label="关闭菜单"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                isActive
                  ? 'bg-green-50 text-green-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-ink'
              }`
            }
          >
            <item.icon className="h-[18px] w-[18px]" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-slate-200 px-3 py-3">
        <div className="mt-2 flex items-center gap-2.5 rounded-lg px-2 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-sm font-semibold text-green-700">
            {user?.name?.[0] || 'C'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-ink">{user?.name}</div>
            <div className="truncate text-[11px] text-slate-400">{user?.email}</div>
          </div>
          <button
            onClick={() => setChangePwdOpen(true)}
            title="修改密码"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-ink"
          >
            <Lock className="h-[18px] w-[18px]" />
          </button>
          <button
            onClick={handleLogout}
            title="退出登录"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-ink"
          >
            <Logout className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen bg-white">
      <div className="hidden md:block">{sidebar}</div>
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/40 transition-opacity"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full transition-transform">
            {sidebar}
          </div>
        </div>
      )}
      <main className="flex-1 overflow-y-auto">
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
            aria-label="打开菜单"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-green-50 text-green-600">
              <Wechat className="h-4 w-4" />
            </div>
            <span className="text-sm font-bold text-ink">客服工作台</span>
          </div>
        </div>
        <Outlet />
      </main>

      {changePwdOpen && <ChangePasswordModal onClose={() => setChangePwdOpen(false)} />}
    </div>
  );
}
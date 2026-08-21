import { Outlet, NavLink, Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth.jsx';
import {
  Shield, ChartBar, Cpu, Users, Activity, Sliders, ArrowRight,
  Logout, Receipt, Layers, Menu, X, Wallet, BookOpen, Wechat, Tag, Lock, Book,
} from '../../components/Icons.jsx';
import ChangePasswordModal from '../../components/ChangePasswordModal.jsx';

const nav = [
  { to: '/admin', label: '概览', icon: ChartBar, end: true },
  { to: '/admin/finance', label: '财务中心', icon: Wallet, end: false },
  { to: '/admin/courses', label: '课程管理', icon: BookOpen, end: false },
  { to: '/admin/course-orders', label: '课程对接', icon: Wechat, end: false },
  { to: '/admin/graduation', label: '毕业作品', icon: Cpu, end: false },
  { to: '/admin/graduation-orders', label: '作品对接', icon: Wechat, end: false },
  { to: '/admin/patent-orders', label: '专利申请', icon: Shield, end: false },
  { to: '/admin/publication-orders', label: '期刊发表', icon: Book, end: false },
  { to: '/admin/features', label: '功能定价', icon: Tag, end: false },
  { to: '/admin/quotes', label: '报价管理', icon: Receipt, end: false },
  { to: '/admin/orders', label: '订单管理', icon: Receipt, end: false },
  { to: '/admin/templates', label: '模板管理', icon: Layers, end: false },
  { to: '/admin/models', label: '模型配置', icon: Cpu, end: false },
  { to: '/admin/users', label: '用户管理', icon: Users, end: false },
  { to: '/admin/logs', label: '使用日志', icon: Activity, end: false },
  { to: '/admin/settings', label: '系统设置', icon: Sliders, end: false },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [changePwdOpen, setChangePwdOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  // 路由切换时关闭移动端侧边栏
  useEffect(() => {
    const handler = () => setSidebarOpen(false);
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  const sidebar = (
    <aside className="flex h-full w-64 flex-col border-r border-slate-200 bg-white">
      {/* Logo 区 */}
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-50 text-accent">
          <Shield className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-bold text-ink">ScholarForge</div>
          <div className="text-[11px] text-slate-400">管理后台</div>
        </div>
        <button
          onClick={() => setSidebarOpen(false)}
          className="ml-auto rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-ink md:hidden"
          aria-label="关闭菜单"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* 导航 */}
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
                  ? 'bg-accent-50 text-accent'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-ink'
              }`
            }
          >
            <item.icon className="h-[18px] w-[18px]" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* 底部 */}
      <div className="border-t border-slate-200 px-3 py-3">
        <Link to="/app" className="btn-ghost w-full justify-start text-xs">
          <ArrowRight className="h-4 w-4" />
          返回用户端
        </Link>
        <div className="mt-2 flex items-center gap-2.5 rounded-lg px-2 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-100 text-sm font-semibold text-accent">
            {user?.name?.[0] || 'A'}
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
      {/* 桌面端固定侧边栏 */}
      <div className="hidden md:block">{sidebar}</div>

      {/* 移动端抽屉式侧边栏 */}
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

      {/* 主内容 */}
      <main className="flex-1 overflow-y-auto">
        {/* 移动端顶栏 */}
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
            aria-label="打开菜单"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-accent-50 text-accent">
              <Shield className="h-4 w-4" />
            </div>
            <span className="text-sm font-bold text-ink">管理后台</span>
          </div>
        </div>
        <Outlet />
      </main>

      {changePwdOpen && <ChangePasswordModal onClose={() => setChangePwdOpen(false)} />}
    </div>
  );
}

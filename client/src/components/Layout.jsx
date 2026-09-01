import { Outlet, NavLink, useNavigate, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { navGroups } from '../lib/navigation.js';
import {
  Logo, Grid, Pen, Book, BookOpen, Receipt, Layers,
  Logout, Shield, ArrowRight, Menu, X, Lock, ChevronRight,
} from './Icons.jsx';
import ChangePasswordModal from './ChangePasswordModal.jsx';

// 导航字符串图标键 → 实际图标组件（与 navigation.js 的 icon 键一一对应）
const NAV_ICONS = {
  grid: Grid,
  layers: Layers,
  pen: Pen,
  book: Book,
  bookopen: BookOpen,
  receipt: Receipt,
};

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [openKey, setOpenKey] = useState(null); // 当前展开的一级入口（手风琴）

  // 路由切换时关闭移动端侧边栏
  useEffect(() => {
    const handler = () => setSidebarOpen(false);
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  // ESC 关闭侧边栏
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    if (sidebarOpen) {
      document.addEventListener('keydown', handler);
      return () => document.removeEventListener('keydown', handler);
    }
  }, [sidebarOpen]);

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const sidebar = (
    <aside className="flex h-full w-64 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <Logo className="h-8 w-8" />
        <div className="leading-tight">
          <div className="text-[15px] font-bold text-ink">ScholarForge</div>
          <div className="text-[11px] text-slate-400">学术写作辅助</div>
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
        {navGroups.map((group) => {
          const Icon = NAV_ICONS[group.icon];
          // 直接入口（工作台 / 我的论文）
          if (group.to) {
            return (
              <NavLink
                key={group.key}
                to={group.to}
                end={group.end}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                    isActive ? 'bg-accent-50 text-accent' : 'text-slate-600 hover:bg-slate-50 hover:text-ink'
                  }`
                }
              >
                {Icon && <Icon className="h-[18px] w-[18px]" />}
                {group.label}
              </NavLink>
            );
          }
          // 可展开分组：默认折叠，点击展开该分类下的二级工具
          const open = openKey === group.key;
          return (
            <div key={group.key}>
              <button
                onClick={() => setOpenKey(open ? null : group.key)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-ink"
              >
                {Icon && <Icon className="h-[18px] w-[18px]" />}
                <span className="flex-1 text-left">{group.label}</span>
                <ChevronRight className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
              </button>
              {open && (
                <div className="mt-0.5 space-y-0.5 border-l border-slate-100 pl-3 ml-4">
                  {group.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      onClick={() => setSidebarOpen(false)}
                      className={({ isActive }) =>
                        `block rounded-lg px-3 py-2 text-sm transition ${
                          isActive ? 'bg-accent-50 text-accent' : 'text-slate-500 hover:bg-slate-50 hover:text-ink'
                        }`
                      }
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* 用户信息 */}
      <div className="border-t border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-100 text-sm font-semibold text-accent">
            {user?.name?.[0] || 'U'}
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
          <button onClick={handleLogout} title="退出登录" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-ink">
            <Logout className="h-[18px] w-[18px]" />
          </button>
        </div>
        {user?.is_admin && (
          <Link to="/admin" className="mt-2 flex items-center justify-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-ink">
            <Shield className="h-3.5 w-3.5" /> 进入管理后台 <ArrowRight className="h-3 w-3" />
          </Link>
        )}
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
            <Logo className="h-6 w-6" />
            <span className="text-sm font-bold text-ink">ScholarForge</span>
          </div>
        </div>
        <Outlet />
      </main>

      {changePwdOpen && <ChangePasswordModal onClose={() => setChangePwdOpen(false)} />}
    </div>
  );
}

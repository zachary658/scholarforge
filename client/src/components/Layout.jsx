import { Outlet, NavLink, useNavigate, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import {
  Logo, Grid, Pen, Globe, Book, BookOpen, FileWord, Receipt, Layers,
  Logout, Shield, ArrowRight, Menu, X,
  FileText, Activity, Cpu, Lock, ChartBar,
} from './Icons.jsx';
import ChangePasswordModal from './ChangePasswordModal.jsx';

// 按场景分组的导航
const navGroups = [
  {
    label: '工作台',
    items: [
      { to: '/app', label: '概览', icon: Grid, end: true },
      { to: '/app/projects', label: '论文工作区', icon: Layers, end: false },
    ],
  },
  {
    label: '1对1指导',
    items: [
      { to: '/app/courses', label: '论文1对1指导', icon: BookOpen, end: false },
      { to: '/app/graduation', label: '毕业作品指导', icon: Cpu, end: false },
      { to: '/app/patent', label: '专利申请', icon: Shield, end: false },
      { to: '/app/publication', label: '期刊论文发表', icon: Book, end: false },
    ],
  },
  {
    label: 'AI 写作',
    items: [
      { to: '/app/writing', label: '论文写作', icon: Pen, end: false },
      { to: '/app/proposal', label: '开题报告', icon: FileWord, end: false },
      { to: '/app/literature-review', label: '文献综述', icon: Book, end: false },
      { to: '/app/task-book', label: '任务书', icon: FileText, end: false },
      { to: '/app/defense', label: '答辩PPT+演讲稿', icon: FileWord, end: false },
      { to: '/app/journal', label: '期刊论文', icon: FileText, end: false },
    ],
  },
  {
    label: '文本优化',
    items: [
      { to: '/app/rewrite', label: '论文降重', icon: Activity, end: false },
      { to: '/app/ai-reduce', label: '降AI率', icon: Shield, end: false },
      { to: '/app/polish', label: '润色翻译', icon: Globe, end: false },
    ],
  },
  {
    label: '资源与账户',
    items: [
      { to: '/app/references', label: '文献管理', icon: Book, end: false },
      { to: '/app/charts', label: '数据图表', icon: ChartBar, end: false },
      { to: '/app/templates', label: '格式模板', icon: Layers, end: false },
      { to: '/app/tasks', label: '我的任务', icon: Activity, end: false },
      { to: '/app/docs', label: '我的文档', icon: FileWord, end: false },
      { to: '/app/orders', label: '我的订单', icon: Receipt, end: false },
      { to: '/app/graduation-orders', label: '毕业作品订单', icon: FileWord, end: false },
    ],
  },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [changePwdOpen, setChangePwdOpen] = useState(false);

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

      <nav className="flex-1 space-y-3 overflow-y-auto px-3 py-2">
        {navGroups.map((group) => (
          <div key={group.label}>
            <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => (
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
            </div>
          </div>
        ))}
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

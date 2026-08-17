import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Refresh, Wechat, Cpu, BookOpen, TrendingUp, AlertCircle, Check, ArrowRight } from '../../components/Icons.jsx';

const CARDS = [
  {
    key: 'pending',
    label: '待对接',
    sub: '课程 + 毕业作品',
    to: '/support/orders',
    icon: Wechat,
    tone: 'bg-amber-50 text-amber-600',
    valueTone: 'text-amber-700',
    value: (o) => (o.pending || 0) + (o.gpPending || 0),
  },
  {
    key: 'today',
    label: '今日新增',
    sub: '课程 + 毕业作品',
    to: '/support/orders',
    icon: TrendingUp,
    tone: 'bg-blue-50 text-blue-600',
    valueTone: 'text-blue-700',
    value: (o) => (o.courseToday || 0) + (o.gpToday || 0),
  },
  {
    key: 'overdue',
    label: '超时未处理',
    sub: '待对接超过 24 小时',
    to: '/support/orders',
    icon: AlertCircle,
    tone: 'bg-red-50 text-red-600',
    valueTone: 'text-red-700',
    value: (o) => (o.courseOverdue || 0) + (o.gpOverdue || 0),
  },
  {
    key: 'quotePending',
    label: '待审批报价',
    sub: '需管理员审批后生效',
    to: '/support/graduation',
    icon: Cpu,
    tone: 'bg-violet-50 text-violet-600',
    valueTone: 'text-violet-700',
    value: (o) => o.gpQuotePending || 0,
  },
  {
    key: 'completed',
    label: '已完成',
    sub: '课程 + 毕业作品',
    to: '/support/orders',
    icon: Check,
    tone: 'bg-green-50 text-green-600',
    valueTone: 'text-green-700',
    value: (o) => (o.completed || 0) + (o.gpCompleted || 0),
  },
];

const QUICK_LINKS = [
  {
    to: '/support/orders',
    title: '课程对接',
    desc: '查看已支付课程订单与需求，标记对接状态',
    icon: Wechat,
    tone: 'bg-green-50 text-green-600',
  },
  {
    to: '/support/graduation',
    title: '毕业作品',
    desc: '毕业作品订单、报价审批与对接跟进',
    icon: Cpu,
    tone: 'bg-blue-50 text-blue-600',
  },
  {
    to: '/support/courses',
    title: '课程列表',
    desc: '查看课程信息、服务内容与定价',
    icon: BookOpen,
    tone: 'bg-amber-50 text-amber-600',
  },
];

export default function SupportDashboard() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.supportOverview();
      setOverview(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">工作台</h1>
          <p className="mt-1 text-sm text-slate-500">聚合今日待办与订单概览，快速进入各对接模块</p>
        </div>
        <button onClick={load} className="btn-ghost text-xs">
          <Refresh className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {/* 统计卡片 */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {CARDS.map((c) => (
          <button
            key={c.key}
            onClick={() => navigate(c.to)}
            className={`group rounded-lg border border-slate-200 ${c.tone} p-3 text-left transition hover:shadow-sm`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs">{c.label}</span>
              <c.icon className="h-4 w-4 opacity-70" />
            </div>
            <div className={`mt-1 text-2xl font-bold ${c.valueTone}`}>
              {overview ? c.value(overview) : '—'}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400">{c.sub}</div>
          </button>
        ))}
      </div>

      {/* 快捷入口 */}
      <div className="mt-8">
        <h2 className="text-sm font-semibold text-slate-600">快捷入口</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          {QUICK_LINKS.map((l) => (
            <button
              key={l.to}
              onClick={() => navigate(l.to)}
              className="card group p-6 text-left transition hover:shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${l.tone}`}>
                  <l.icon className="h-6 w-6" />
                </div>
                <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
              </div>
              <h3 className="mt-4 font-semibold text-ink">{l.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">{l.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

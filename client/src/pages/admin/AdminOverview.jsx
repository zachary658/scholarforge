import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Users, Activity, Refresh, Cart, Receipt, Wallet, Gift, Check, Crown } from '../../components/Icons.jsx';

export default function AdminOverview() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const d = await api.adminOverview();
      setData(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const fmt = (n) => (Number(n) || 0).toLocaleString('zh-CN');

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-8 py-8 text-sm text-slate-400">加载中…</div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-6xl px-8 py-8">
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
        <button onClick={load} className="btn-ghost mt-4">
          <Refresh className="h-4 w-4" /> 重试
        </button>
      </div>
    );
  }

  if (!data) return null;

  const stats = [
    {
      label: '总用户数',
      value: fmt(data.users?.total),
      hint: `今日新增 ${fmt(data.users?.newToday ?? 0)}`,
      icon: Users,
    },
    {
      label: '今日订单',
      value: fmt(data.orders?.today),
      hint: `待支付 ${fmt(data.orders?.pending ?? 0)}`,
      icon: Receipt,
    },
    {
      label: '总收入',
      value: `¥${fmt(data.revenue?.total)}`,
      hint: `今日 ¥${fmt(data.revenue?.today ?? 0)} / 本周 ¥${fmt(data.revenue?.week ?? 0)}`,
      icon: Wallet,
    },
    {
      label: '总调用次数',
      value: fmt(data.calls?.total),
      hint: `今日调用 ${fmt(data.calls?.today ?? 0)}`,
      icon: Activity,
    },
  ];

  const stats2 = [
    {
      label: '积分套餐销量',
      value: fmt(data.packages?.sold ?? 0),
      hint: `套餐收入 ¥${fmt(data.packages?.revenue ?? 0)}`,
      icon: Cart,
    },
    {
      label: '活跃用户',
      value: fmt(data.users?.active),
      hint: '近 7 天',
      icon: Users,
    },
    {
      label: '成功 / 失败调用',
      value: `${fmt(data.calls?.success)} / ${fmt(data.calls?.failed)}`,
      hint: '累计调用结果统计',
      icon: Check,
    },
    {
      label: 'Token 消耗',
      value: fmt(data.tokens),
      hint: '累计 Token 用量',
      icon: Crown,
    },
  ];

  const byTool = Array.isArray(data.byTool) ? data.byTool : [];
  const maxTool = byTool.reduce((m, t) => Math.max(m, Number(t.count) || 0), 0);

  const trend = Array.isArray(data.trend) ? data.trend : [];
  const maxCalls = trend.reduce((m, t) => Math.max(m, Number(t.calls) || 0), 0);

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">概览</h1>
          <p className="mt-1 text-sm text-slate-500">平台运营数据总览</p>
        </div>
        <button onClick={load} disabled={loading} className="btn-ghost text-xs">
          <Refresh className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* 统计卡片 第一行 */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">{s.label}</span>
              <s.icon className="h-4 w-4 text-slate-400" />
            </div>
            <div className="mt-3 text-3xl font-bold text-ink">{s.value}</div>
            <div className="mt-1 text-xs text-slate-400">{s.hint}</div>
          </div>
        ))}
      </div>

      {/* 统计卡片 第二行 */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats2.map((s) => (
          <div key={s.label} className="card p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">{s.label}</span>
              <s.icon className="h-4 w-4 text-slate-400" />
            </div>
            <div className="mt-3 text-3xl font-bold text-ink">{s.value}</div>
            <div className="mt-1 text-xs text-slate-400">{s.hint}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* 积分套餐销量摘要 */}
        <div className="card p-6">
          <div className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-accent" />
            <h3 className="text-sm font-semibold text-ink">积分套餐销售</h3>
          </div>
          <div className="mt-4 text-3xl font-bold text-ink">
            ¥{fmt(data.packages?.revenue ?? 0)}
          </div>
          <p className="mt-2 text-xs text-slate-400">累计售出套餐 {fmt(data.packages?.sold ?? 0)} 份</p>
        </div>

        {/* 工具调用分布 */}
        <div className="card p-6 lg:col-span-2">
          <h3 className="text-sm font-semibold text-ink">工具调用分布</h3>
          <div className="mt-4 space-y-3">
            {byTool.length === 0 && (
              <p className="text-sm text-slate-400">暂无数据</p>
            )}
            {byTool.map((t) => (
              <div key={t.tool_type || t.tool}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-600">{t.tool_type || t.tool}</span>
                  <span className="text-slate-400">{fmt(t.count)}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${maxTool ? (Number(t.count) / maxTool) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 近 7 天趋势 */}
      <div className="card mt-6 p-6">
        <h3 className="text-sm font-semibold text-ink">近 7 天调用趋势</h3>
        <div className="mt-6 flex items-end justify-between gap-3" style={{ height: 180 }}>
          {trend.length === 0 && (
            <p className="text-sm text-slate-400">暂无数据</p>
          )}
          {trend.map((t) => {
            const h = maxCalls ? (Number(t.calls) / maxCalls) * 100 : 0;
            const day = t.day ? String(t.day).slice(5) : '';
            return (
              <div key={t.day} className="flex flex-1 flex-col items-center justify-end gap-2">
                <span className="text-xs text-slate-400">{fmt(t.calls)}</span>
                <div className="flex w-full items-end justify-center" style={{ height: 120 }}>
                  <div
                    className="w-2/3 rounded-t bg-accent transition-all"
                    style={{ height: `${h}%`, minHeight: t.calls > 0 ? 4 : 0 }}
                  />
                </div>
                <span className="text-[11px] text-slate-400">{day}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

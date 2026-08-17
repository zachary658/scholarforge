import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import {
  Wallet, Refresh, TrendingUp, TrendingDown, Coins, Receipt,
  Cart, Gift, Users,
} from '../../components/Icons.jsx';

const RANGES = [
  { value: 7, label: '近 7 天' },
  { value: 30, label: '近 30 天' },
  { value: 90, label: '近 90 天' },
  { value: 365, label: '近 1 年' },
];

const CHANNEL_LABEL = {
  mock: '模拟支付',
  alipay: '支付宝',
  wechat: '微信支付',
  unknown: '未知',
};

const TYPE_LABEL = {
  feature: '功能调用',
  points_package: '积分套餐',
  course: '课程购买',
};

function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNum(n) {
  return (Number(n) || 0).toLocaleString('zh-CN');
}
function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function shortDay(day) {
  if (!day) return '';
  return String(day).slice(5);
}

export default function AdminFinance() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [range, setRange] = useState(30);

  const load = async (r = range) => {
    setLoading(true);
    setError('');
    try {
      const d = await api.adminFinance({ range: r });
      setData(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  if (loading && !data) {
    return <div className="mx-auto max-w-6xl px-8 py-8 text-sm text-slate-400">加载中…</div>;
  }
  if (error && !data) {
    return (
      <div className="mx-auto max-w-6xl px-8 py-8">
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
        <button onClick={() => load()} className="btn-ghost mt-4">
          <Refresh className="h-4 w-4" /> 重试
        </button>
      </div>
    );
  }
  if (!data) return null;

  const s = data.summary || {};
  const inc = data.income || {};
  const byType = data.byType || [];
  const byPackage = data.byPackage || [];
  const byChannel = data.byChannel || [];
  const trend = data.trend || [];
  const refunds = data.refunds || [];
  const recent = data.recentOrders || [];

  // 日同比
  const dayDelta = (inc.today?.amount || 0) - (inc.yesterday?.amount || 0);
  const dayDeltaPct = inc.yesterday?.amount > 0
    ? (dayDelta / inc.yesterday.amount) * 100
    : (inc.today?.amount > 0 ? 100 : 0);

  // 趋势图最大值
  const maxAmount = trend.reduce((m, t) => Math.max(m, Number(t.amount) || 0), 0);

  // 排行最大值
  const maxTypeAmt = byType.reduce((m, t) => Math.max(m, Number(t.amount) || 0), 0);

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      {/* 标题 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">财务中心</h1>
          <p className="mt-1 text-sm text-slate-500">平台资金流水与收入分析</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setRange(r.value)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  range === r.value ? 'bg-accent text-white' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button onClick={() => load()} disabled={loading} className="btn-ghost text-xs">
            <Refresh className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      {/* 核心指标卡片 */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* 累计总收入 */}
        <div className="card overflow-hidden p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">累计总收入</span>
            <Wallet className="h-4 w-4 text-accent" />
          </div>
          <div className="mt-3 text-3xl font-bold text-ink">¥{fmtMoney(inc.total?.amount)}</div>
          <div className="mt-1 text-xs text-slate-400">共 {fmtNum(inc.total?.count)} 笔已支付订单</div>
        </div>

        {/* 今日收入 + 同比 */}
        <div className="card overflow-hidden p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">今日收入</span>
            {dayDelta >= 0 ? (
              <TrendingUp className="h-4 w-4 text-green-500" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-500" />
            )}
          </div>
          <div className="mt-3 text-3xl font-bold text-ink">¥{fmtMoney(inc.today?.amount)}</div>
          <div className={`mt-1 text-xs ${dayDelta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {dayDelta >= 0 ? '↑' : '↓'} ¥{fmtMoney(Math.abs(dayDelta))} · {dayDeltaPct >= 0 ? '+' : ''}{dayDeltaPct.toFixed(1)}% 同比昨日
          </div>
        </div>

        {/* 区间收入 */}
        <div className="card overflow-hidden p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">{RANGES.find(r => r.value === range)?.label}收入</span>
            <Coins className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-3 text-3xl font-bold text-ink">¥{fmtMoney(inc.range?.amount)}</div>
          <div className="mt-1 text-xs text-slate-400">{fmtNum(inc.range?.count)} 笔订单 · ARPPU ¥{fmtMoney(data.arppu)}</div>
        </div>

        {/* 付费用户数 */}
        <div className="card overflow-hidden p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">付费用户数</span>
            <Users className="h-4 w-4 text-blue-500" />
          </div>
          <div className="mt-3 text-3xl font-bold text-ink">{fmtNum(data.payingUsers)}</div>
          <div className="mt-1 text-xs text-slate-400">区间内产生付费的去重用户</div>
        </div>
      </div>

      {/* 时段收入对比 */}
      <div className="card mt-4 p-6">
        <h3 className="text-sm font-semibold text-ink">收入时段对比</h3>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: '昨日', amount: inc.yesterday?.amount, count: inc.yesterday?.count },
            { label: '今日', amount: inc.today?.amount, count: inc.today?.count },
            { label: '本周', amount: inc.week?.amount, count: inc.week?.count },
            { label: '本月', amount: inc.month?.amount, count: inc.month?.count },
          ].map((it) => (
            <div key={it.label} className="rounded-lg border border-slate-100 bg-slate-50 p-4">
              <div className="text-xs text-slate-500">{it.label}</div>
              <div className="mt-2 text-xl font-bold text-ink">¥{fmtMoney(it.amount)}</div>
              <div className="mt-0.5 text-[11px] text-slate-400">{fmtNum(it.count)} 笔</div>
            </div>
          ))}
        </div>
      </div>

      {/* 收入趋势图 */}
      <div className="card mt-4 p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">每日收入趋势</h3>
          <span className="text-xs text-slate-400">{RANGES.find(r => r.value === range)?.label}</span>
        </div>
        <div className="mt-6 flex items-end justify-between gap-1" style={{ height: 200 }}>
          {trend.length === 0 && (
            <p className="w-full text-center text-sm text-slate-400">暂无收入数据</p>
          )}
          {trend.map((t) => {
            const h = maxAmount ? (Number(t.amount) / maxAmount) * 100 : 0;
            return (
              <div key={t.day} className="flex flex-1 flex-col items-center justify-end gap-1.5" title={`${shortDay(t.day)}: ¥${fmtMoney(t.amount)} (${t.orders}笔)`}>
                <span className="text-[10px] text-slate-400">{Number(t.amount) > 0 ? `¥${fmtMoney(t.amount)}` : ''}</span>
                <div className="flex w-full items-end justify-center" style={{ height: 140 }}>
                  <div
                    className="w-2/3 rounded-t bg-gradient-to-t from-accent-400 to-accent transition-all"
                    style={{ height: `${h}%`, minHeight: Number(t.amount) > 0 ? 3 : 0 }}
                  />
                </div>
                <span className="text-[10px] text-slate-400">{shortDay(t.day)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 业务类型 + 支付通道 */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-ink">业务类型收入分布</h3>
          <div className="mt-4 space-y-3">
            {byType.length === 0 && <p className="text-sm text-slate-400">暂无数据</p>}
            {byType.map((t) => {
              const label = t.biz_type === 'points_package' ? '积分套餐' : t.biz_type === 'course' ? '课程购买' : '功能调用';
              const Icon = t.biz_type === 'points_package' ? Cart : Receipt;
              const pct = maxTypeAmt ? (Number(t.amount) / maxTypeAmt) * 100 : 0;
              return (
                <div key={t.biz_type}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-medium text-slate-700">
                      <Icon className="h-3.5 w-3.5 text-slate-400" />
                      {label}
                      <span className="text-slate-400">({fmtNum(t.count)} 笔)</span>
                    </span>
                    <span className="font-semibold text-ink">¥{fmtMoney(t.amount)}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card p-6">
          <h3 className="text-sm font-semibold text-ink">支付通道分布</h3>
          <div className="mt-4 space-y-3">
            {byChannel.length === 0 && <p className="text-sm text-slate-400">暂无数据</p>}
            {byChannel.map((c) => {
              const label = CHANNEL_LABEL[c.channel] || c.channel;
              const pct = maxTypeAmt ? (Number(c.amount) / (inc.range?.amount || 1)) * 100 : 0;
              return (
                <div key={c.channel}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700">
                      {label} <span className="text-slate-400">({fmtNum(c.count)} 笔)</span>
                    </span>
                    <span className="font-semibold text-ink">¥{fmtMoney(c.amount)}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-blue-400" style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 积分套餐销量 */}
      <div className="mt-4">
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-ink">积分套餐销量排行 TOP 10</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th className="pb-2 pr-3 font-medium">套餐</th>
                  <th className="pb-2 pr-3 text-right font-medium">销量</th>
                  <th className="pb-2 text-right font-medium">收入</th>
                </tr>
              </thead>
              <tbody>
                {byPackage.length === 0 && (
                  <tr><td colSpan={3} className="py-6 text-center text-sm text-slate-400">暂无数据</td></tr>
                )}
                {byPackage.map((c, i) => (
                  <tr key={c.package_id} className="border-b border-slate-50 text-sm last:border-0">
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${i < 3 ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>
                          {i + 1}
                        </span>
                        <span className="font-medium text-ink">{c.target_name || `#${c.package_id}`}</span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{fmtNum(c.count)}</td>
                    <td className="py-2.5 text-right font-semibold text-ink">¥{fmtMoney(c.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 近期订单 */}
      <div className="card mt-4 p-6">
        <h3 className="text-sm font-semibold text-ink">近期已支付订单</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                <th className="pb-2 pr-3 font-medium">订单号</th>
                <th className="pb-2 pr-3 font-medium">用户</th>
                <th className="pb-2 pr-3 font-medium">类型</th>
                <th className="pb-2 pr-3 font-medium">商品</th>
                <th className="pb-2 pr-3 font-medium">通道</th>
                <th className="pb-2 pr-3 text-right font-medium">金额</th>
                <th className="pb-2 text-right font-medium">支付时间</th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-sm text-slate-400">暂无订单</td></tr>
              )}
              {recent.map((o) => (
                <tr key={o.order_no} className="border-b border-slate-50 text-sm last:border-0">
                  <td className="py-2.5 pr-3 font-mono text-xs text-slate-500">{o.order_no}</td>
                  <td className="py-2.5 pr-3 text-slate-600">{o.user_name || o.user_email || '—'}</td>
                  <td className="py-2.5 pr-3">
                    <span className={`rounded-md px-1.5 py-0.5 text-xs ${o.type === 'points_package' ? 'bg-purple-50 text-purple-600' : o.type === 'course' ? 'bg-indigo-50 text-indigo-600' : 'bg-blue-50 text-blue-600'}`}>
                      {TYPE_LABEL[o.type] || o.type}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-slate-700">{o.target_name}</td>
                  <td className="py-2.5 pr-3 text-slate-500">{CHANNEL_LABEL[o.payment_channel] || o.payment_channel}</td>
                  <td className="py-2.5 pr-3 text-right font-semibold text-ink">¥{fmtMoney(o.amount)}</td>
                  <td className="py-2.5 text-right text-xs text-slate-400">{fmtDate(o.paid_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 退款记录 */}
      <div className="card mt-4 p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">退款记录</h3>
          <span className="rounded-md bg-red-50 px-2 py-0.5 text-xs text-red-600">
            共 {fmtNum(s.refunded_count)} 笔 · ¥{fmtMoney(s.refunded_amount)}
          </span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                <th className="pb-2 pr-3 font-medium">订单号</th>
                <th className="pb-2 pr-3 font-medium">用户</th>
                <th className="pb-2 pr-3 font-medium">商品</th>
                <th className="pb-2 pr-3 text-right font-medium">退款金额</th>
                <th className="pb-2 pr-3 font-medium">原因</th>
                <th className="pb-2 text-right font-medium">退款时间</th>
              </tr>
            </thead>
            <tbody>
              {refunds.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-sm text-slate-400">暂无退款记录</td></tr>
              )}
              {refunds.map((r) => (
                <tr key={r.order_no} className="border-b border-slate-50 text-sm last:border-0">
                  <td className="py-2.5 pr-3 font-mono text-xs text-slate-500">{r.order_no}</td>
                  <td className="py-2.5 pr-3 text-slate-600">{r.user_name || r.user_email || '—'}</td>
                  <td className="py-2.5 pr-3 text-slate-700">{r.target_name}</td>
                  <td className="py-2.5 pr-3 text-right font-semibold text-red-600">-¥{fmtMoney(r.amount)}</td>
                  <td className="py-2.5 pr-3 text-xs text-slate-500">{r.refund_reason || '—'}</td>
                  <td className="py-2.5 text-right text-xs text-slate-400">{fmtDate(r.refunded_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

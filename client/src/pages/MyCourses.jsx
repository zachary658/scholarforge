import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../lib/api.js';
import PayModal from '../components/PayModal.jsx';
import { toast } from '../components/Toast.jsx';
import { Crown, Gift, Cart, Refresh, Layers, TrendingUp } from '../components/Icons.jsx';

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts) * 1000);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('zh-CN');
}

function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts) * 1000);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN');
}

const TYPE_LABEL = {
  signup_bonus: '注册赠送',
  topup: '积分充值',
  consume: '功能消耗',
  refund: '退款返还',
  admin_adjust: '管理员调整',
};

export default function MyCourses() {
  const { refreshStatus } = useOutletContext();
  const [packages, setPackages] = useState([]);
  const [balance, setBalance] = useState(0);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [buyingId, setBuyingId] = useState(null);
  const [payState, setPayState] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [pkgData, pointsData, logData] = await Promise.all([
        api.getPointsPackages(),
        api.myPoints(),
        api.myPointsLog({ size: 20 }),
      ]);
      setPackages(pkgData.packages || []);
      setBalance(pointsData.balance || 0);
      setLogs(logData.logs || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const buy = async (pkg) => {
    setBuyingId(pkg.id);
    setError('');
    try {
      const data = await api.createOrder({ type: 'points_package', target: pkg.id });
      setPayState(data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBuyingId(null);
    }
  };

  const onPaid = async () => {
    setPayState(null);
    toast.success('充值成功，积分已到账');
    // 刷新全站积分余额（侧边栏/工作台等）
    refreshStatus?.();
    try {
      const [pointsData, logData] = await Promise.all([
        api.myPoints(),
        api.myPointsLog({ size: 20 }),
      ]);
      setBalance(pointsData.balance || 0);
      setLogs(logData.logs || []);
    } catch { /* ignore */ }
  };

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">积分充值</h1>
          <p className="mt-1 text-sm text-slate-500">充值积分，用于论文写作、降重、降AI率等各项功能</p>
        </div>
        <button onClick={load} className="btn-ghost text-xs">
          <Refresh className="h-4 w-4" /> 刷新
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {/* 积分余额 */}
      <div className="card mt-6 p-6">
        <div className="flex items-center gap-2">
          <Gift className="h-5 w-5 text-accent" />
          <h3 className="text-sm font-semibold text-ink">我的积分</h3>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg bg-accent-50 px-4 py-4">
            <div className="text-xs text-accent-700">当前积分余额</div>
            <div className="mt-1 text-3xl font-bold text-accent">{balance}</div>
            <div className="mt-1 text-xs text-accent-600">1 元 = 10 积分</div>
          </div>
          <div className="rounded-lg bg-slate-50 px-4 py-4">
            <div className="text-xs text-slate-500">积分说明</div>
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              <li className="flex items-center gap-1.5">
                <Gift className="h-3 w-3 text-green-500" /> 新用户注册即送 30 积分
              </li>
              <li className="flex items-center gap-1.5">
                <TrendingUp className="h-3 w-3 text-amber-500" /> 充值积分永久有效，无过期时间
              </li>
              <li className="flex items-center gap-1.5">
                <Cart className="h-3 w-3 text-accent" /> 各功能按次消耗积分，明码标价
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* 充值套餐 */}
      <div className="mt-8 flex items-center gap-2">
        <Cart className="h-5 w-5 text-accent" />
        <h2 className="text-sm font-semibold text-ink">积分充值套餐</h2>
      </div>
      {loading ? (
        <div className="card mt-4 p-10 text-center text-sm text-slate-400">加载中…</div>
      ) : packages.length === 0 ? (
        <div className="card mt-4 p-10 text-center text-sm text-slate-400">暂无可用充值套餐</div>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {packages.map((pkg) => (
            <div key={pkg.id} className="card flex flex-col p-5">
              <h3 className="text-base font-semibold text-ink">{pkg.name}</h3>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="inline-flex items-center gap-1 rounded-md bg-accent-50 px-2 py-1 text-accent-700">
                  <Gift className="h-3.5 w-3.5" /> {pkg.points} 积分
                  {pkg.bonus_points > 0 && (
                    <span className="text-green-600">+{pkg.bonus_points} 赠送</span>
                  )}
                </span>
                {pkg.bonus_points > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-green-50 px-2 py-1 text-green-700">
                    共 {pkg.points + pkg.bonus_points} 积分
                  </span>
                )}
              </div>
              <div className="mt-5 flex items-end justify-between border-t border-slate-100 pt-4">
                <div>
                  <div className="text-xs text-slate-400">价格</div>
                  <div className="text-2xl font-bold text-accent">
                    ¥{Number(pkg.price).toFixed(2)}
                  </div>
                </div>
                <button
                  onClick={() => buy(pkg)}
                  disabled={buyingId === pkg.id}
                  className="btn-primary"
                >
                  {buyingId === pkg.id ? (
                    <><Refresh className="h-4 w-4 animate-spin" /> 处理中…</>
                  ) : (
                    <><Cart className="h-4 w-4" /> 充值</>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 积分变动记录 */}
      <div className="mt-10 flex items-center gap-2">
        <Layers className="h-5 w-5 text-accent" />
        <h2 className="text-sm font-semibold text-ink">积分变动记录</h2>
      </div>
      {logs.length === 0 ? (
        <div className="card mt-4 flex flex-col items-center justify-center py-12 text-center">
          <Layers className="h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm text-slate-400">暂无积分变动记录</p>
        </div>
      ) : (
        <div className="card mt-4 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                  <th className="px-4 py-3">类型</th>
                  <th className="px-4 py-3">变动</th>
                  <th className="px-4 py-3">余额</th>
                  <th className="px-4 py-3">说明</th>
                  <th className="px-4 py-3">时间</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-slate-100 text-sm last:border-0">
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${
                        l.type === 'signup_bonus' ? 'bg-green-50 text-green-700' :
                        l.type === 'topup' ? 'bg-blue-50 text-blue-700' :
                        l.type === 'consume' ? 'bg-amber-50 text-amber-700' :
                        l.type === 'refund' ? 'bg-purple-50 text-purple-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {TYPE_LABEL[l.type] || l.type}
                      </span>
                    </td>
                    <td className={`px-4 py-3 font-medium ${l.points >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {l.points > 0 ? '+' : ''}{l.points}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{l.balance_after}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{l.description || '—'}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{fmtDateTime(l.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {payState && (
        <PayModal
          order={payState.order}
          payParams={payState.payParams}
          onClose={() => setPayState(null)}
          onPaid={onPaid}
        />
      )}
    </div>
  );
}
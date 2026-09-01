import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import PayModal from './PayModal.jsx';
import { Cart, Refresh, X } from './Icons.jsx';

const CHANNEL_LABEL = {
  mock: '模拟支付（演示）',
  alipay: '支付宝',
  wechat: '微信支付',
};

// 已知支付通道白名单：未知通道一律视为无效，避免渲染出误导性选项
const KNOWN_CHANNELS = new Set(['mock', 'alipay', 'wechat']);

// 收费功能「先下单支付→再生成」的引导弹窗（模态框，居中显示）
// needOrder: { itemType, amount, materialIds }
// onPaid(orderNo): 支付成功后回调，携带订单号重新执行工具
// onClose(): 关闭弹窗（仅取消本次支付引导，不影响已生成内容）
export default function FeaturePay({ needOrder, onPaid, onClose }) {
  const [channel, setChannel] = useState('');
  const [channels, setChannels] = useState([]);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [channelError, setChannelError] = useState('');
  const [payState, setPayState] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // 从后端拉取可用支付通道。
  // 安全：加载失败或后端未返回有效通道时，绝不回退 mock——生产环境绝不能出现「模拟支付」，
  // 否则客户可能零成本绕过付费。失败时清空通道、提示并提供「重新加载」。
  const loadChannels = useCallback(async () => {
    setLoadingChannels(true);
    setChannelError('');
    try {
      const d = await api.getChannels();
      const list = Array.isArray(d.channels)
        ? d.channels.filter((c) => KNOWN_CHANNELS.has(c))
        : [];
      setChannels(list);
      // 默认选中第一个真实通道；仅开发环境后端显式返回 mock 时才可用 mock 演示
      const real = list.find((c) => c !== 'mock');
      setChannel(real || list[0] || '');
      if (list.length === 0) {
        setChannelError('暂无可用的支付方式，请稍后重试或联系客服');
      }
    } catch {
      // 拉取通道失败（500 / 断网）：清空通道，禁止下单，绝不回退 mock
      setChannels([]);
      setChannel('');
      setChannelError('支付方式加载失败');
    } finally {
      setLoadingChannels(false);
    }
  }, []);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  // 仅当存在有效通道时才允许下单
  const canOrder = !creating && !loadingChannels && !channelError && !!channel && channels.includes(channel);

  const createAndPay = async () => {
    if (!canOrder) return;
    if (!KNOWN_CHANNELS.has(channel)) {
      setError('支付通道无效，请重新选择');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const data = await api.createFeatureOrder({
        item_type: needOrder.itemType,
        quantity: 1,
        payment_method: channel,
        material_ids: needOrder.materialIds && needOrder.materialIds.length > 0 ? needOrder.materialIds : undefined,
      });
      setPayState(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const amount = Number(needOrder.amount || 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="功能付费"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}
    >
      <div className="w-[420px] max-w-full rounded-xl bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="flex items-center gap-2 text-base font-semibold text-ink">
            <Cart className="h-5 w-5 text-accent" /> 本功能为付费功能
          </h3>
          {onClose && (
            <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-ink" aria-label="关闭">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="px-6 py-5">
          <div className="rounded-lg bg-slate-50 p-4">
            <div className="text-center">
              <div className="text-sm text-slate-500">需支付</div>
              <div className="mt-1 text-3xl font-bold text-accent">¥{amount.toFixed(2)}</div>
            </div>
          </div>

          <div className="mt-4">
            <label className="label" htmlFor="feature-pay-channel">支付方式</label>
            {loadingChannels ? (
              <div className="flex items-center gap-2 py-2 text-sm text-slate-400">
                <Refresh className="h-4 w-4 animate-spin" /> 正在加载支付方式…
              </div>
            ) : channelError ? (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700" role="alert">
                {channelError}
                <button
                  onClick={loadChannels}
                  className="btn-ghost ml-2 inline-flex items-center gap-1 px-2 py-1 text-xs"
                >
                  <Refresh className="h-3.5 w-3.5" /> 重新加载
                </button>
              </div>
            ) : channels.length > 0 ? (
              <select
                id="feature-pay-channel"
                className="input"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
              >
                {channels.map((c) => (
                  <option key={c} value={c}>{CHANNEL_LABEL[c] || c}</option>
                ))}
              </select>
            ) : (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700" role="alert">
                暂无可用的支付方式，请稍后重试或联系客服
              </div>
            )}
          </div>

          {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

          <button
            onClick={createAndPay}
            disabled={!canOrder}
            className="btn-primary mt-4 w-full py-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? (
              <><Refresh className="h-4 w-4 animate-spin" /> 正在创建订单…</>
            ) : (
              <>下单支付 ¥{amount.toFixed(2)}</>
            )}
          </button>
          <p className="mt-2 text-center text-xs text-slate-400">支付成功后自动开始生成，无需刷新页面</p>
        </div>

        {payState && (
          <PayModal
            order={payState.order}
            payParams={payState.payParams}
            onClose={() => setPayState(null)}
            onPaid={() => {
              const orderNo = payState.order?.order_no;
              setPayState(null);
              onPaid(orderNo);
            }}
          />
        )}
      </div>
    </div>
  );
}

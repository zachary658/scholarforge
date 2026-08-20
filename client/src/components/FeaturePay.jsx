import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import PayModal from './PayModal.jsx';
import { Cart, Refresh, X } from './Icons.jsx';

const CHANNEL_LABEL = {
  mock: '模拟支付（演示）',
  alipay: '支付宝',
  wechat: '微信支付',
};

// 收费功能「先下单支付→再生成」的引导弹窗（模态框，居中显示）
// needOrder: { itemType, amount }
// onPaid(orderNo): 支付成功后回调，携带订单号重新执行工具
// onClose(): 关闭弹窗（仅取消本次支付引导，不影响已生成内容）
export default function FeaturePay({ needOrder, onPaid, onClose }) {
  const [channel, setChannel] = useState('');
  const [channels, setChannels] = useState([]);
  const [payState, setPayState] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // 从后端拉取可用支付通道：生产环境永不返回 mock（后端 getAvailableChannels 保证），
  // 默认选中第一个真实通道，避免「默认模拟支付」在真实下单时误导用户零成本绕过支付
  useEffect(() => {
    api.getChannels()
      .then((d) => {
        const list = Array.isArray(d.channels) ? d.channels : [];
        setChannels(list);
        const real = list.find((c) => c !== 'mock');
        setChannel(real || list[0] || '');
      })
      .catch(() => {
        // 拉取通道失败（网络异常等）：回退 mock 兜底，保证演示环境仍可下单；
        // 生产环境后端通道接口正常，不会走到此分支
        setChannels(['mock']);
        setChannel('mock');
      });
  }, []);

  const createAndPay = async () => {
    setCreating(true);
    setError('');
    try {
      const data = await api.createFeatureOrder({
        item_type: needOrder.itemType,
        quantity: 1,
        payment_method: channel,
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
            <label className="label">支付方式</label>
            <select className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>
              {(channels.length > 0 ? channels : ['mock']).map((c) => (
                <option key={c} value={c}>{CHANNEL_LABEL[c] || c}</option>
              ))}
            </select>
          </div>

          {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

          <button onClick={createAndPay} disabled={creating || !channel} className="btn-primary mt-4 w-full py-3">
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

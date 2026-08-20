import { useState } from 'react';
import { api } from '../lib/api.js';
import PayModal from './PayModal.jsx';
import { Cart, Refresh, X } from './Icons.jsx';

// 收费功能「先下单支付→再生成」的引导弹窗（模态框，居中显示）
// needOrder: { itemType, amount }
// onPaid(orderNo): 支付成功后回调，携带订单号重新执行工具
// onClose(): 关闭弹窗（仅取消本次支付引导，不影响已生成内容）
export default function FeaturePay({ needOrder, onPaid, onClose }) {
  const [channel, setChannel] = useState('mock');
  const [payState, setPayState] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

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
              <option value="mock">模拟支付（演示）</option>
              <option value="alipay">支付宝</option>
              <option value="wechat">微信支付</option>
            </select>
          </div>

          {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

          <button onClick={createAndPay} disabled={creating} className="btn-primary mt-4 w-full py-3">
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

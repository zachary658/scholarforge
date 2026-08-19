import { useState } from 'react';
import { api } from '../lib/api.js';
import PayModal from './PayModal.jsx';
import { Cart, Refresh } from './Icons.jsx';

// 收费功能「先下单支付→再生成」的引导组件
// needOrder: { itemType, amount }
// onPaid(orderNo): 支付成功后回调，携带订单号重新执行工具
export default function FeaturePay({ needOrder, onPaid }) {
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

  return (
    <div className="mt-4 rounded-lg border border-accent/20 bg-accent-50 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-ink">
          <Cart className="h-4 w-4 shrink-0 text-accent" />
          <span>
            本功能为付费功能，需支付{' '}
            <strong className="text-accent">¥{Number(needOrder.amount || 0).toFixed(2)}</strong>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input w-28 py-1.5 text-xs"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
          >
            <option value="mock">模拟支付</option>
            <option value="alipay">支付宝</option>
            <option value="wechat">微信支付</option>
          </select>
          <button onClick={createAndPay} disabled={creating} className="btn-primary px-3 py-2 text-xs">
            {creating ? (
              <><Refresh className="h-3.5 w-3.5 animate-spin" /> 处理中…</>
            ) : (
              <>下单支付</>
            )}
          </button>
        </div>
      </div>
      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
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
  );
}

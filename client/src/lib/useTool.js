import { useState, useCallback } from 'react';

// 通用工具调用 + 现金直付计费流程封装
// 各工具页面共用：调用后端工具接口，收费功能若未关联订单则返回 needOrder，
// 供页面渲染「先下单支付→再生成」引导；免费功能（大纲/文献检索/格式化）直接放行。
//
// 用法：
//   const tool = useTool();
//   await tool.run(() => api.polish({ text }));
//   tool.result    -> 渲染结果（含 content / doc / chargeType / amount / orderNo）
//   tool.needOrder -> { itemType, amount }，渲染 <FeaturePay />
export function useTool() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { content, doc, model, tokens, chargeType, amount, orderNo, ... }
  const [needOrder, setNeedOrder] = useState(null); // { itemType, amount }

  const run = useCallback(async (apiCall) => {
    setError('');
    setLoading(true);
    setResult(null);
    setNeedOrder(null);
    try {
      const data = await apiCall();
      if (data.needOrder) {
        setNeedOrder({ itemType: data.itemType, amount: data.amount });
        return;
      }
      setResult(data);
    } catch (err) {
      setError(err.message || '调用失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError('');
    setNeedOrder(null);
    setLoading(false);
  }, []);

  return { loading, error, result, needOrder, run, reset, setError };
}

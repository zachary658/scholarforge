import { useState, useCallback } from 'react';

// 通用工具调用 + 计费流程封装
// 各工具页面共用：调用后端工具接口，按大模型用量预扣积分，
// 积分不足时返回 needRecharge，供页面渲染充值引导
//
// 用法：
//   const tool = useTool(refreshStatus);
//   await tool.run(() => api.polish({ text }));
//   tool.result      -> 渲染结果（含 content / doc / chargeType / amount / deductedPoints）
//   tool.needRecharge -> 渲染 <RechargeBanner balance needed />
export function useTool(refreshStatus) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { content, doc, model, tokens, chargeType, amount, orderId, ... }
  const [needRecharge, setNeedRecharge] = useState(null); // { balance, needed }

  const run = useCallback(async (apiCall, opts = {}) => {
    setError('');
    setLoading(true);
    setResult(null);
    setNeedRecharge(null);
    try {
      const data = await apiCall();
      if (data.needPoints) {
        // 积分不足：提示充值（后端按大模型用量预估后返回所需积分）
        setNeedRecharge({ balance: data.balance, needed: data.needed });
        setError(`积分不足：本次约需 ${data.needed} 积分，当前 ${data.balance}`);
        return;
      }
      setResult(data);
      refreshStatus?.();
    } catch (err) {
      setError(err.message || '调用失败');
    } finally {
      setLoading(false);
    }
  }, [refreshStatus]);

  const reset = useCallback(() => {
    setResult(null);
    setError('');
    setNeedRecharge(null);
    setLoading(false);
  }, []);

  return { loading, error, result, needRecharge, run, reset, setError };
}

import { useState, useCallback, useRef } from 'react';
import { toast } from '../components/Toast.jsx';

// 通用工具调用 + 现金直付计费流程封装
// 各工具页面共用：调用后端工具接口，收费功能若未关联订单则返回 needOrder，
// 供页面渲染「先下单支付→再生成」引导；免费功能（大纲/文献检索/格式化）直接放行。
//
// 自动归档提示：后端返回 autoProject 时（未指定工作区自动创建「我的论文工作区」），
// toast 提示用户内容已保存与保留期限，防止内容丢失。
//
// 用法：
//   const tool = useTool();
//   await tool.run(() => api.polish({ text }));
//   tool.result    -> 渲染结果（含 content / doc / chargeType / amount / orderNo）
//   tool.needOrder -> { itemType, amount }，渲染 <FeaturePay />
export function useTool() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [errorData, setErrorData] = useState(null); // 后端业务标志（needAcademicIntegrity / needConfirmOutline 等）
  const [result, setResult] = useState(null); // { content, doc, model, tokens, chargeType, amount, orderNo, ... }
  const [needOrder, setNeedOrder] = useState(null); // { itemType, amount }
  const seqRef = useRef(0); // 请求序号：响应回来时若已发出更新的请求则丢弃旧响应，防止竞态覆盖

  const run = useCallback(async (apiCall) => {
    const seq = ++seqRef.current;
    setError('');
    setErrorData(null);
    setLoading(true);
    setResult(null);
    setNeedOrder(null);
    try {
      const data = await apiCall();
      if (seq !== seqRef.current) return; // 已有更新的请求发出，丢弃旧响应
      if (data.needOrder) {
        // 保留 materialIds：带参考材料的订单必须把它传给下单接口，
        // 否则订单金额缺材料费且支付后生成会命中后端材料一致性校验而失败
        setNeedOrder({ itemType: data.itemType, amount: data.amount, materialIds: data.materialIds || [] });
        return;
      }
      setResult(data);
      // 自动归档提示：内容已保存到论文工作区，提醒保留期限与及时下载
      if (data?.autoProject) {
        const days = data.retention_days || 30;
        toast.success(
          `内容已自动保存到论文工作区「${data.autoProjectTitle || '我的论文工作区'}」，可在工作区随时回看；内容保留 ${days} 天，请及时下载 Word 保存`,
          7000
        );
      }
      return data;
    } catch (err) {
      if (seq !== seqRef.current) return; // 已有更新的请求发出，丢弃旧响应
      setError(err.message || '调用失败');
      setErrorData(err.data || null);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError('');
    setErrorData(null);
    setNeedOrder(null);
    setLoading(false);
  }, []);

  // 仅关闭支付弹窗：清除 needOrder，保留已生成结果（避免误清用户内容）
  const cancelOrder = useCallback(() => {
    setNeedOrder(null);
    setLoading(false);
  }, []);

  return { loading, error, errorData, result, needOrder, run, reset, cancelOrder, setError };
}

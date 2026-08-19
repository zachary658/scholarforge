import { useEffect, useRef, useState, useCallback } from 'react';
import QRCode from 'qrcode';
import { api } from '../lib/api.js';
import { X, Refresh, Check } from './Icons.jsx';

const CHANNEL_LABEL = {
  mock: '模拟支付（演示）',
  alipay: '支付宝',
  wechat: '微信支付',
};

const POLL_INTERVAL = 2000;
const POLL_MAX_DURATION = 15 * 60 * 1000; // 15 分钟超时

export default function PayModal({ order, payParams, onClose, onPaid }) {
  const channel = payParams?.channel || order?.payment_channel || 'mock';
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [loadingQr, setLoadingQr] = useState(false);
  const [paying, setPaying] = useState(false);
  const [status, setStatus] = useState(order?.status || 'pending');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const pollRef = useRef(null);
  const pollStartRef = useRef(0);

  const amount = Number(order?.amount || 0);
  const isReal = channel === 'alipay' || channel === 'wechat';

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const generateQr = useCallback(async (qrText) => {
    try {
      const dataUrl = await QRCode.toDataURL(qrText, {
        width: 200,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      });
      return dataUrl;
    } catch {
      return null;
    }
  }, []);

  // 真实通道：拉取二维码 + 轮询
  useEffect(() => {
    if (!isReal) return;
    let cancelled = false;

    const fetchQr = async () => {
      setLoadingQr(true);
      setError('');
      try {
        let data;
        if (channel === 'alipay') data = await api.alipayQrcode(order.order_no);
        else data = await api.wechatQrcode(order.order_no);
        if (cancelled) return;
        const qrText = data.qr_code || data.code_url || null;
        if (qrText) {
          const dataUrl = await generateQr(qrText);
          if (!cancelled) {
            setQrDataUrl(dataUrl);
            if (dataUrl) {
              startPolling();
            } else {
              setError('二维码生成失败，请重试');
            }
          }
        } else {
          setError('未获取到支付二维码');
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoadingQr(false);
      }
    };

    const startPolling = () => {
      stopPolling();
      pollStartRef.current = Date.now();
      pollRef.current = setInterval(async () => {
        // 超时检查
        if (Date.now() - pollStartRef.current > POLL_MAX_DURATION) {
          stopPolling();
          setError('支付超时，订单已取消，请重新发起');
          setStatus('cancelled');
          return;
        }
        try {
          const s = await api.orderStatus(order.order_no);
          if (cancelled) return;
          setStatus(s.status);
          if (s.status === 'paid') {
            stopPolling();
            await finishReal(s);
          } else if (s.status === 'cancelled') {
            stopPolling();
            setError('订单已取消');
          }
        } catch { /* ignore poll errors */ }
      }, POLL_INTERVAL);
    };

    const finishReal = async (s) => {
      setDone(true);
      setPaying(false);
      onPaid?.({ order: { ...order, status: 'paid' } });
    };

    fetchQr();
    return () => {
      cancelled = true;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCount]);

  // mock 支付
  const handleMockPay = async () => {
    setPaying(true);
    setError('');
    try {
      const data = await api.mockPay(order.order_no);
      setStatus('paid');
      setDone(true);
      onPaid?.({ order: data.order || { ...order, status: 'paid' } });
    } catch (err) {
      setError(err.message);
    } finally {
      setPaying(false);
    }
  };

  const handleRetryQr = () => {
    setQrDataUrl(null);
    setError('');
    setRetryCount((c) => c + 1);
  };

  // 组件卸载时清理
  useEffect(() => stopPolling, [stopPolling]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[420px] max-w-full rounded-xl bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-base font-semibold text-ink">
            {done ? '支付成功' : '确认支付'}
          </h3>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5">
          {/* 订单摘要 */}
          <div className="rounded-lg bg-slate-50 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">商品</span>
              <span className="font-medium text-ink">{order?.target_name || '—'}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-slate-500">订单号</span>
              <span className="font-mono text-xs text-slate-600">{order?.order_no}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-sm text-slate-500">支付方式</span>
              <span className="text-sm font-medium text-ink">{CHANNEL_LABEL[channel] || channel}</span>
            </div>
            <div className="mt-3 flex items-end justify-between border-t border-slate-200 pt-3">
              <span className="text-sm text-slate-500">需支付</span>
              <span className="text-2xl font-bold text-accent">¥{amount.toFixed(2)}</span>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
          )}

          {/* 支付区域 */}
          {!done && (
            <div className="mt-5">
              {channel === 'mock' ? (
                <div className="text-center">
                  <p className="text-xs text-slate-400">演示模式：点击下方按钮立即完成支付</p>
                  <button onClick={handleMockPay} disabled={paying} className="btn-primary mt-3 w-full py-3">
                    {paying ? (
                      <><Refresh className="h-4 w-4 animate-spin" /> 处理中…</>
                    ) : (
                      <>立即支付 ¥{amount.toFixed(2)}</>
                    )}
                  </button>
                </div>
              ) : (
                <div className="text-center">
                  {loadingQr ? (
                    <div className="flex flex-col items-center py-6 text-slate-400">
                      <Refresh className="h-6 w-6 animate-spin" />
                      <p className="mt-2 text-xs">正在生成二维码…</p>
                    </div>
                  ) : qrDataUrl ? (
                    <>
                      <div className="mx-auto inline-block rounded-lg border border-slate-200 bg-white p-2">
                        <img src={qrDataUrl} alt="支付二维码" className="h-[200px] w-[200px]" />
                      </div>
                      <p className="mt-3 text-sm font-medium text-ink">
                        请使用{channel === 'alipay' ? '支付宝' : '微信'}扫码支付
                      </p>
                      <p className="mt-1 text-xs text-slate-400">支付完成后将自动跳转，无需关闭窗口</p>
                      <p className="mt-2 text-xs text-slate-400">
                        当前状态：{status === 'pending' ? '等待支付…' : status}
                      </p>
                    </>
                  ) : (
                    <div className="flex flex-col items-center py-6">
                      <p className="text-sm text-slate-400">二维码生成失败</p>
                      <button onClick={handleRetryQr} className="btn-ghost mt-3">
                        <Refresh className="h-4 w-4" /> 重新生成
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {done && (
            <div className="mt-5 flex flex-col items-center py-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-50 text-green-500">
                <Check className="h-6 w-6" />
              </div>
              <p className="mt-3 text-sm font-medium text-ink">支付成功</p>
              <p className="mt-1 text-xs text-slate-400">
                权益已发放到账户
              </p>
              <button onClick={onClose} className="btn-primary mt-4">
                <Check className="h-4 w-4" /> 完成
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

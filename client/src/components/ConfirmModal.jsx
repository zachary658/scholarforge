// 通用确认弹窗 + useConfirm hook
// 用法：
//   const confirm = useConfirm();
//   if (await confirm({ title: '删除', message: '确认删除？', danger: true })) { ... }
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AlertCircle, X } from './Icons.jsx';

const ConfirmContext = createContext(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    // 兜底：上下文缺失时降级为 window.confirm，保证功能不中断
    return (opts) => Promise.resolve(window.confirm(opts?.message || '确认操作？'));
  }
  return ctx.confirm;
}

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null); // { title, message, danger, confirmText, cancelText, resolve }
  const idRef = useRef(0);

  const confirm = useCallback((opts = {}) => {
    const id = ++idRef.current;
    return new Promise((resolve) => {
      setState({
        id,
        title: opts.title || '请确认',
        message: opts.message || '',
        detail: opts.detail || '',
        danger: !!opts.danger,
        confirmText: opts.confirmText || '确认',
        cancelText: opts.cancelText || '取消',
        resolve,
      });
    });
  }, []);

  const close = useCallback((result) => {
    setState((cur) => {
      if (cur?.resolve) cur.resolve(result);
      return null;
    });
  }, []);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => e.target === e.currentTarget && close(false)}
        >
          <div className="w-[400px] max-w-full rounded-xl bg-white shadow-card">
            <div className="flex items-start gap-3 p-6">
              <div
                className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${
                  state.danger ? 'bg-red-50 text-red-500' : 'bg-amber-50 text-amber-500'
                }`}
              >
                <AlertCircle className="h-5 w-5" />
              </div>
              <div className="flex-1 pt-0.5">
                <h3 className="text-base font-semibold text-ink">{state.title}</h3>
                {state.message && (
                  <p className="mt-1 text-sm text-slate-600">{state.message}</p>
                )}
                {state.detail && (
                  <p className="mt-1 text-xs text-slate-400">{state.detail}</p>
                )}
              </div>
              <button
                onClick={() => close(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button onClick={() => close(false)} className="btn-secondary">
                {state.cancelText}
              </button>
              <button
                onClick={() => close(true)}
                className={state.danger ? 'btn-danger' : 'btn-primary'}
              >
                {state.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

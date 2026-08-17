// 全局 Toast 通知组件
// 用法：在任意组件中调用 toast.success('消息') / toast.error('消息') / toast.info('消息')
import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { Check, X, AlertCircle, Info } from './Icons.jsx';

const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) return { success: () => {}, error: () => {}, info: () => {}, warning: () => {} };
  return ctx;
}

// 全局引用，供非组件代码使用
let globalToast = null;
export const toast = {
  success: (msg) => globalToast?.success(msg),
  error: (msg) => globalToast?.error(msg),
  info: (msg) => globalToast?.info(msg),
  warning: (msg) => globalToast?.warning(msg),
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const remove = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const add = useCallback((type, message, duration = 3000) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, type, message }]);
    if (duration > 0) {
      setTimeout(() => remove(id), duration);
    }
    return id;
  }, [remove]);

  const api = {
    success: (msg, d) => add('success', msg, d),
    error: (msg, d) => add('error', msg, d ?? 5000),
    info: (msg, d) => add('info', msg, d),
    warning: (msg, d) => add('warning', msg, d),
    remove,
  };

  globalToast = api;

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} {...t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ type, message, onClose }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const config = {
    success: { icon: Check, bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', iconBg: 'bg-green-100', iconColor: 'text-green-500' },
    error: { icon: AlertCircle, bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', iconBg: 'bg-red-100', iconColor: 'text-red-500' },
    warning: { icon: AlertCircle, bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', iconBg: 'bg-amber-100', iconColor: 'text-amber-500' },
    info: { icon: Info, bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', iconBg: 'bg-blue-100', iconColor: 'text-blue-500' },
  };
  const c = config[type] || config.info;
  const Icon = c.icon;

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border ${c.border} ${c.bg} px-4 py-3 shadow-card transition-all duration-300 ${
        visible ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0'
      }`}
      style={{ minWidth: '280px', maxWidth: '420px' }}
    >
      <div className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${c.iconBg}`}>
        <Icon className={`h-3.5 w-3.5 ${c.iconColor}`} />
      </div>
      <p className={`flex-1 text-sm font-medium ${c.text}`}>{message}</p>
      <button onClick={onClose} className={`flex-shrink-0 rounded p-0.5 ${c.text} opacity-60 hover:opacity-100`}>
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

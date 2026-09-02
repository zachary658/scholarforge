import { useEffect, useRef } from 'react';

// 通用弹窗壳层（P1-6 无障碍闭环）
// 统一实现此前各组件各自复制的模态行为：
//   - 打开后焦点自动进入弹窗内第一个可聚焦元素；
//   - Tab / Shift+Tab 焦点循环锁在弹窗内，不会跑到弹窗背后；
//   - Escape 关闭；
//   - 打开期间锁定页面滚动，关闭后恢复；
//   - 关闭后焦点返回到触发按钮；
//   - 可选 aria-live 区域（支付状态 / 任务进度等动态内容播报）。
// 用法：
//   <Modal onClose={...} label="确认" panelClassName="w-[400px]">...</Modal>
export default function Modal({
  onClose,
  label,
  labelledBy,
  children,
  panelClassName = '',
  ariaLive = null,
  open = true,
}) {
  const panelRef = useRef(null);
  const prevFocusRef = useRef(null);

  const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  useEffect(() => {
    if (!open) return undefined;
    prevFocusRef.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => {
      const list = panelRef.current?.querySelectorAll(FOCUSABLE);
      if (list && list.length) list[0].focus();
    }, 0);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      prevFocusRef.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && onClose) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = panelRef.current?.querySelectorAll(FOCUSABLE);
      if (!list || list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      aria-labelledby={labelledBy}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}
    >
      <div ref={panelRef} className={`max-w-full rounded-xl bg-white shadow-card ${panelClassName}`}>
        {children}
        {ariaLive && <span aria-live="polite" className="sr-only">{ariaLive}</span>}
      </div>
    </div>
  );
}

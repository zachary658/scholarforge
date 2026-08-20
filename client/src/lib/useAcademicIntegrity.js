import { useRef, useState, useCallback } from 'react';
import { useAuth } from './auth.jsx';

// 学术诚信承诺书门禁（阶段四 4.1）
// 敏感功能调用前调用 ensure()：已同意返回 true；未同意则弹出承诺书，
// 同意后自动重新执行被拦截的操作（pendingRef 保存的回调）。
export function useAcademicIntegrity() {
  const { user, updateUser } = useAuth();
  const [show, setShow] = useState(false);
  const pendingRef = useRef(null);
  // 用 ref 镜像 user，确保 handleAgreed 同步重放 action 时，
  // action 内部再次调用 ensure 能读到「已同意」的最新状态（修复弹窗反复弹出的死循环）。
  // 直接依赖 useCallback([user]) 的闭包在 updateUser 异步更新前永远是旧值。
  const agreedRef = useRef(!!user?.academic_integrity_agreed);
  agreedRef.current = !!user?.academic_integrity_agreed;

  const ensure = useCallback((action) => {
    if (agreedRef.current) return true;
    pendingRef.current = action || null;
    setShow(true);
    return false;
  }, []);

  const handleAgreed = useCallback(() => {
    // 先同步更新 ref，再触发异步 state 更新，保证重放 action 时 ensure 立即放行
    agreedRef.current = true;
    updateUser({ academic_integrity_agreed: true });
    setShow(false);
    const action = pendingRef.current;
    pendingRef.current = null;
    action?.();
  }, [updateUser]);

  const close = useCallback(() => {
    pendingRef.current = null;
    setShow(false);
  }, []);

  return { show, ensure, handleAgreed, close };
}

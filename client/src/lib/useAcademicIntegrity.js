import { useRef, useState, useCallback } from 'react';
import { useAuth } from './auth.jsx';

// 学术诚信承诺书门禁（阶段四 4.1）
// 敏感功能调用前调用 ensure()：已同意返回 true；未同意则弹出承诺书，
// 同意后自动重新执行被拦截的操作（pendingRef 保存的回调）。
export function useAcademicIntegrity() {
  const { user, updateUser } = useAuth();
  const [show, setShow] = useState(false);
  const pendingRef = useRef(null);

  const ensure = useCallback((action) => {
    if (user?.academic_integrity_agreed) return true;
    pendingRef.current = action || null;
    setShow(true);
    return false;
  }, [user]);

  const handleAgreed = useCallback(() => {
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

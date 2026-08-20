import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api, clearTokens, bootstrapToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    // 内存中无 token 时，尝试用 refresh cookie 静默续期（避免每次刷新页面都登出）
    const ok = await bootstrapToken();
    if (!ok) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const data = await api.me();
      setUser(data.user);
    } catch (err) {
      // 仅 401（token 失效）才清空用户；网络错误等瞬时故障保留原状态，避免误登出
      if (err && err.status === 401) {
        setUser(null);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = useCallback(async (payload) => {
    const data = await api.login(payload);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const data = await api.register(payload);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  // 清除本地会话（不触发网络请求）：用于修改密码后强制重新登录
  const clearSession = useCallback(() => {
    clearTokens();
    setUser(null);
  }, []);

  const updateUser = useCallback((patch) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, clearSession, refreshUser, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

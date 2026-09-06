import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api, clearTokens, bootstrapToken } from './api.js';

const AuthContext = createContext(null);
const WORK_MODE_KEY = 'sf_work_mode_choice';

function readWorkMode(user) {
  if (!user) return null;
  try {
    const saved = JSON.parse(sessionStorage.getItem(WORK_MODE_KEY) || 'null');
    const userKey = String(user.id || user.email || '');
    return saved?.userKey === userKey && ['full', 'other'].includes(saved?.mode) ? saved.mode : null;
  } catch {
    return null;
  }
}

function clearSavedWorkMode() {
  try { sessionStorage.removeItem(WORK_MODE_KEY); } catch {}
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [workMode, setWorkMode] = useState(null);

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
      setWorkMode(readWorkMode(data.user));
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
    clearSavedWorkMode();
    setWorkMode(null);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const data = await api.register(payload);
    clearSavedWorkMode();
    setWorkMode(null);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    clearSavedWorkMode();
    setWorkMode(null);
    setUser(null);
  }, []);

  // 清除本地会话（不触发网络请求）：用于修改密码后强制重新登录
  const clearSession = useCallback(() => {
    clearTokens();
    clearSavedWorkMode();
    setWorkMode(null);
    setUser(null);
  }, []);

  const updateUser = useCallback((patch) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const chooseWorkMode = useCallback((mode) => {
    if (!user || !['full', 'other'].includes(mode)) return;
    const choice = { userKey: String(user.id || user.email || ''), mode };
    try { sessionStorage.setItem(WORK_MODE_KEY, JSON.stringify(choice)); } catch {}
    setWorkMode(mode);
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, loading, workMode, chooseWorkMode, login, register, logout, clearSession, refreshUser, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

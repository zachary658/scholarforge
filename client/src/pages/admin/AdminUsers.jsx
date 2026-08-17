import { useEffect, useState, useRef } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { Plus, Search, Trash, X, Crown, Coins } from '../../components/Icons.jsx';
import { toast } from '../../components/Toast.jsx';
import { useConfirm } from '../../components/ConfirmModal.jsx';

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts) * 1000);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('zh-CN');
}

export default function AdminUsers() {
  const { user: me } = useAuth();
  const confirm = useConfirm();
  const [list, setList] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createModal, setCreateModal] = useState(false);
  const [pointsModal, setPointsModal] = useState(null); // user
  const [createForm, setCreateForm] = useState({ email: '', password: '', name: '', is_admin: false, is_support: false });
  const [pointsForm, setPointsForm] = useState({ delta: '', description: '' });
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef(null);

  const SIZE = 20;

  const load = async (p = 1, query = searchQ) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.adminListUsers({ page: p, size: SIZE, q: query });
      setList(data.users || data.items || []);
      setPage(data.page || p);
      setPages(data.pages || 1);
      setTotal(data.total ?? (data.users || data.items || []).length);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1);
  }, []);

  const onSearchChange = (v) => {
    setQ(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQ(v);
      load(1, v);
    }, 350);
  };

  const onSearchKey = (e) => {
    if (e.key === 'Enter') {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setSearchQ(q);
      load(1, q);
    }
  };

  const toggleStatus = async (u) => {
    setError('');
    try {
      await api.adminUpdateUser(u.id, { status: u.status === 'banned' ? 'active' : 'banned' });
      toast.success('已更新用户状态');
      load(page);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggleAdmin = async (u) => {
    setError('');
    try {
      await api.adminUpdateUser(u.id, { is_admin: !u.is_admin });
      toast.success(u.is_admin ? '已取消管理员' : '已设为管理员');
      load(page);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggleSupport = async (u) => {
    setError('');
    try {
      await api.adminUpdateUser(u.id, { is_support: !u.is_support });
      toast.success(u.is_support ? '已取消客服' : '已设为客服');
      load(page);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = async (u) => {
    if (u.email === 'admin@scholarforge.com') return;
    if (!await confirm({
      title: '删除确认',
      message: `确认删除「${u.name || u.email}」？此操作不可撤销。`,
      danger: true,
      confirmText: '删除',
    })) return;
    setError('');
    try {
      await api.adminDeleteUser(u.id);
      toast.success('用户已删除');
      load(page);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openCreate = () => {
    setCreateForm({ email: '', password: '', name: '', is_admin: false, is_support: false });
    setCreateModal(true);
  };

  const submitCreate = async () => {
    setSaving(true);
    setError('');
    try {
      await api.adminCreateUser(createForm);
      toast.success('用户已创建');
      setCreateModal(false);
      load(1);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const openPoints = (u) => {
    setPointsForm({ delta: '', description: '' });
    setPointsModal(u);
  };

  const submitPoints = async () => {
    const delta = parseInt(pointsForm.delta, 10);
    if (isNaN(delta) || delta === 0) {
      toast.warning('请输入有效的积分变动量（非零整数）');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const desc = pointsForm.description || (delta > 0 ? '管理员增加积分' : '管理员扣减积分');
      await api.adminAdjustPoints(pointsModal.id, { delta, description: desc });
      toast.success(delta > 0 ? `已增加 ${delta} 积分` : `已扣减 ${Math.abs(delta)} 积分`);
      setPointsModal(null);
      load(page);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">用户管理</h1>
          <p className="mt-1 text-sm text-slate-500">共 {total} 位用户</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input w-56 pl-9"
              placeholder="搜索邮箱或姓名"
              value={q}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={onSearchKey}
            />
          </div>
          <button onClick={openCreate} className="btn-primary">
            <Plus className="h-4 w-4" /> 新增用户
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      <div className="card mt-6 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                <th className="px-4 py-3">用户</th>
                <th className="px-4 py-3">积分余额</th>
                <th className="px-4 py-3">订单数</th>
                <th className="px-4 py-3">总消费</th>
                <th className="px-4 py-3">调用次数</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">注册时间</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">加载中…</td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">暂无用户</td>
                </tr>
              ) : (
                list.map((u) => {
                  const isSelf = me && String(u.id) === String(me.id);
                  const isProtected = u.email === 'admin@scholarforge.com';
                  const banned = u.status === 'banned';
                  return (
                    <tr key={u.id} className="border-b border-slate-100 text-sm last:border-0">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-100 text-xs font-semibold text-accent">
                            {(u.name || u.email || 'U')[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 font-medium text-ink">
                              {u.name || '—'}
                              {u.is_admin && <Crown className="h-3.5 w-3.5 text-accent" />}
                              {u.is_support && !u.is_admin && <span className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-600">客服</span>}
                              {isSelf && <span className="text-[10px] text-slate-400">(你)</span>}
                            </div>
                            <div className="truncate text-xs text-slate-400">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-slate-700">{u.points ?? 0}</div>
                        <div className="text-[11px] text-slate-400">积分</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{u.paid_orders ?? 0}</td>
                      <td className="px-4 py-3 text-slate-600">¥{(Number(u.total_spent) || 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-slate-600">{u.total_calls ?? 0}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-md px-2 py-0.5 text-xs ${banned ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                          {banned ? '已禁用' : '正常'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(u.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-1">
                          <button onClick={() => openPoints(u)} className="btn-ghost text-xs">
                            <Coins className="h-3.5 w-3.5" /> 调整积分
                          </button>
                          <button
                            onClick={() => toggleStatus(u)}
                            disabled={isSelf}
                            className="btn-ghost text-xs disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {banned ? '启用' : '禁用'}
                          </button>
                          <button
                            onClick={() => toggleAdmin(u)}
                            disabled={isSelf}
                            className="btn-ghost text-xs disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {u.is_admin ? '取消管理员' : '设为管理员'}
                          </button>
                          <button
                            onClick={() => remove(u)}
                            disabled={isProtected || isSelf}
                            className="btn-ghost text-xs text-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                          >
                            <Trash className="h-3.5 w-3.5" /> 删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 分页 */}
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-slate-500">第 {page} / {pages} 页</span>
          <div className="flex gap-2">
            <button
              onClick={() => load(page - 1)}
              disabled={page <= 1}
              className="btn-secondary text-xs disabled:opacity-40"
            >
              上一页
            </button>
            <button
              onClick={() => load(page + 1)}
              disabled={page >= pages}
              className="btn-secondary text-xs disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        </div>
      )}

      {/* 新增用户 Modal */}
      {createModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-[440px] max-w-full rounded-xl bg-white shadow-card">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="text-base font-semibold text-ink">新增用户</h3>
              <button onClick={() => setCreateModal(false)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-ink">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 px-6 py-5">
              <div>
                <label className="label">邮箱</label>
                <input
                  className="input"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  placeholder="user@example.com"
                />
              </div>
              <div>
                <label className="label">密码</label>
                <input
                  type="password"
                  className="input"
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  placeholder="至少 8 位，含字母和数字"
                />
              </div>
              <div>
                <label className="label">姓名</label>
                <input
                  className="input"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  placeholder="可选"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent"
                  checked={createForm.is_admin}
                  onChange={(e) => setCreateForm({ ...createForm, is_admin: e.target.checked })}
                />
                设为管理员
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button onClick={() => setCreateModal(false)} className="btn-secondary">取消</button>
              <button onClick={submitCreate} disabled={saving} className="btn-primary">
                {saving ? '创建中…' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 调整积分 Modal */}
      {pointsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-[440px] max-w-full rounded-xl bg-white shadow-card">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="text-base font-semibold text-ink">调整积分</h3>
              <button onClick={() => setPointsModal(null)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-ink">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 px-6 py-5">
              <p className="text-sm text-slate-500">
                为 <span className="font-medium text-ink">{pointsModal.name || pointsModal.email}</span> 调整积分
              </p>
              <div className="flex items-center gap-3 rounded-lg bg-accent-50 px-4 py-3">
                <Coins className="h-5 w-5 text-accent" />
                <div>
                  <div className="text-xs text-accent-700">当前积分余额</div>
                  <div className="text-xl font-bold text-accent">{pointsModal.points ?? 0}</div>
                </div>
              </div>
              <div>
                <label className="label">积分变动量（正数增加，负数扣减）</label>
                <input
                  type="number"
                  className="input"
                  value={pointsForm.delta}
                  onChange={(e) => setPointsForm({ ...pointsForm, delta: e.target.value })}
                  placeholder="例如：100 或 -50"
                />
                <p className="mt-1.5 text-xs text-slate-400">输入正数赠送积分，输入负数扣减积分</p>
              </div>
              <div>
                <label className="label">备注说明</label>
                <input
                  className="input"
                  value={pointsForm.description}
                  onChange={(e) => setPointsForm({ ...pointsForm, description: e.target.value })}
                  placeholder="可选，记录变动原因"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button onClick={() => setPointsModal(null)} className="btn-secondary">取消</button>
              <button onClick={submitPoints} disabled={saving} className="btn-primary">
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

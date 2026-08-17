import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Plus, Edit, Trash, X, Refresh } from '../../components/Icons.jsx';
import { toast } from '../../components/Toast.jsx';
import { useConfirm } from '../../components/ConfirmModal.jsx';

const emptyForm = {
  id: '',
  name: '',
  price: 0,
  points: 0,
  bonus_points: 0,
  is_active: true,
  sort_order: 0,
};

export default function AdminCourses() {
  const confirm = useConfirm();
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // { mode: 'create' | 'edit' }
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.adminListPointsPackages();
      setPackages(Array.isArray(data.packages) ? data.packages : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setForm({ ...emptyForm });
    setModal({ mode: 'create' });
  };

  const openEdit = (p) => {
    setForm({
      id: p.id ?? '',
      name: p.name ?? '',
      price: p.price ?? 0,
      points: p.points ?? 0,
      bonus_points: p.bonus_points ?? 0,
      is_active: p.is_active !== false,
      sort_order: p.sort_order ?? 0,
    });
    setModal({ mode: 'edit' });
  };

  const close = () => {
    setModal(null);
    setForm(emptyForm);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.warning('请填写套餐名称');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: form.name.trim(),
        price: Number(form.price) || 0,
        points: Number(form.points) || 0,
        bonus_points: Number(form.bonus_points) || 0,
        is_active: !!form.is_active,
        sort_order: Number(form.sort_order) || 0,
      };
      if (modal.mode === 'edit' && form.id) payload.id = form.id;
      await api.adminSavePointsPackage(payload);
      toast.success(modal.mode === 'create' ? '套餐已新增' : '套餐已更新');
      close();
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p) => {
    if (!await confirm({
      title: '删除确认',
      message: `确认删除「${p.name}」？此操作不可撤销。`,
      danger: true,
      confirmText: '删除',
    })) return;
    setError('');
    try {
      await api.adminDeletePointsPackage(p.id);
      toast.success('套餐已删除');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">积分套餐管理</h1>
          <p className="mt-1 text-sm text-slate-500">管理积分充值套餐，1元 = 10积分</p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="h-4 w-4" /> 新增套餐
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      <div className="card mt-6 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                <th className="px-4 py-3">名称</th>
                <th className="px-4 py-3">价格</th>
                <th className="px-4 py-3">基础积分</th>
                <th className="px-4 py-3">赠送积分</th>
                <th className="px-4 py-3">合计</th>
                <th className="px-4 py-3">排序</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">加载中…</td>
                </tr>
              ) : packages.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">暂无套餐</td>
                </tr>
              ) : (
                packages.map((p) => {
                  const active = p.is_active !== false;
                  return (
                    <tr key={p.id} className="border-b border-slate-100 text-sm last:border-0">
                      <td className="px-4 py-3 font-medium text-ink">{p.name || '—'}</td>
                      <td className="px-4 py-3 text-slate-700">¥{Number(p.price ?? 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-slate-600">{p.points ?? 0}</td>
                      <td className="px-4 py-3 text-green-600">{p.bonus_points > 0 ? `+${p.bonus_points}` : '—'}</td>
                      <td className="px-4 py-3 font-medium text-slate-700">{(p.points ?? 0) + (p.bonus_points ?? 0)}</td>
                      <td className="px-4 py-3 text-slate-600">{p.sort_order ?? 0}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-md px-2 py-0.5 text-xs ${active ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                          {active ? '启用' : '停用'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-1">
                          <button onClick={() => openEdit(p)} className="btn-ghost text-xs">
                            <Edit className="h-3.5 w-3.5" /> 编辑
                          </button>
                          <button
                            onClick={() => remove(p)}
                            className="btn-ghost text-xs text-red-500 hover:bg-red-50"
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

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-[520px] max-w-full rounded-xl bg-white shadow-card">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="text-base font-semibold text-ink">
                {modal.mode === 'create' ? '新增套餐' : '编辑套餐'}
              </h3>
              <button onClick={close} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-ink">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-5">
              <div>
                <label className="label">名称</label>
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="如 100积分包"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">价格 (¥)</label>
                  <input
                    type="number"
                    className="input"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    step="0.01"
                  />
                </div>
                <div>
                  <label className="label">基础积分</label>
                  <input
                    type="number"
                    className="input"
                    value={form.points}
                    onChange={(e) => setForm({ ...form, points: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">赠送积分</label>
                  <input
                    type="number"
                    className="input"
                    value={form.bonus_points}
                    onChange={(e) => setForm({ ...form, bonus_points: e.target.value })}
                  />
                  <p className="mt-1.5 text-xs text-slate-400">额外赠送的积分，用户实际获得 = 基础 + 赠送</p>
                </div>
                <div>
                  <label className="label">排序</label>
                  <input
                    type="number"
                    className="input"
                    value={form.sort_order}
                    onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
                  />
                  <p className="mt-1.5 text-xs text-slate-400">数值越小越靠前</p>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-ink">启用</div>
                  <div className="text-xs text-slate-400">停用后前台不展示该套餐</div>
                </div>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, is_active: !form.is_active })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                    form.is_active ? 'bg-accent' : 'bg-slate-200'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                      form.is_active ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button onClick={close} className="btn-secondary">取消</button>
              <button onClick={save} disabled={saving} className="btn-primary">
                <Refresh className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} />
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
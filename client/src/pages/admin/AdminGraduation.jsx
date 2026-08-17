import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Plus, Edit, Trash, X, Refresh } from '../../components/Icons.jsx';
import { toast } from '../../components/Toast.jsx';
import { useConfirm } from '../../components/ConfirmModal.jsx';

const CATEGORY_OPTIONS = ['建筑图纸', '机械图纸', '仿真模拟', '计算机程序', 'PLC设计', '其他'];

const emptyForm = {
  id: '',
  title: '',
  category: '',
  description: '',
  base_price: 0,
  duration_text: '',
  degree: '',
  is_active: true,
  sort_order: 0,
};

export default function AdminGraduation() {
  const confirm = useConfirm();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.adminListGraduationProjects();
      setProjects(Array.isArray(data.projects) ? data.projects : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setForm({ ...emptyForm });
    setModal({ mode: 'create' });
  };

  const openEdit = (p) => {
    setForm({
      id: p.id ?? '',
      title: p.title ?? '',
      category: p.category ?? '',
      description: p.description ?? '',
      base_price: p.base_price ?? 0,
      duration_text: p.duration_text ?? '',
      degree: p.degree ?? '',
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
    if (!form.title.trim()) {
      toast.warning('请填写项目名称');
      return;
    }
    if (!form.category) {
      toast.warning('请选择分类');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        title: form.title.trim(),
        category: form.category,
        description: form.description.trim(),
        base_price: Number(form.base_price) || 0,
        duration_text: form.duration_text.trim(),
        degree: form.degree.trim(),
        is_active: !!form.is_active,
        sort_order: Number(form.sort_order) || 0,
      };
      if (modal.mode === 'edit' && form.id) payload.id = form.id;
      await api.adminSaveGraduationProject(payload);
      toast.success(modal.mode === 'create' ? '毕业作品已新增' : '毕业作品已更新');
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
      message: `确认删除「${p.title}」？此操作不可撤销。`,
      danger: true,
      confirmText: '删除',
    })) return;
    setError('');
    try {
      await api.adminDeleteGraduationProject(p.id);
      toast.success('毕业作品已删除');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">毕业作品管理</h1>
          <p className="mt-1 text-sm text-slate-500">管理毕业作品指导项目，用户可购买后下单</p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="h-4 w-4" /> 新增作品
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
                <th className="px-4 py-3">项目名称</th>
                <th className="px-4 py-3">分类</th>
                <th className="px-4 py-3">基础价格</th>
                <th className="px-4 py-3">时长</th>
                <th className="px-4 py-3">排序</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">加载中…</td>
                </tr>
              ) : projects.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">暂无毕业作品</td>
                </tr>
              ) : (
                projects.map((p) => {
                  const active = p.is_active !== false;
                  return (
                    <tr key={p.id} className="border-b border-slate-100 text-sm last:border-0">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-ink">{p.title || '—'}</span>
                          {p.degree && <span className="rounded bg-accent-50 px-1.5 py-0.5 text-xs text-accent">{p.degree}</span>}
                        </div>
                        {p.description && <div className="mt-0.5 max-w-[320px] truncate text-xs text-slate-400">{p.description}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{p.category || '—'}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">¥{Number(p.base_price ?? 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-slate-600">{p.duration_text || '—'}</td>
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
                          <button onClick={() => remove(p)} className="btn-ghost text-xs text-red-500 hover:bg-red-50">
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
          <div className="w-[560px] max-w-full rounded-xl bg-white shadow-card">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="text-base font-semibold text-ink">
                {modal.mode === 'create' ? '新增毕业作品' : '编辑毕业作品'}
              </h3>
              <button onClick={close} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-ink">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-5">
              <div>
                <label className="label">项目名称</label>
                <input
                  className="input"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="如 建筑图纸设计指导"
                />
              </div>
              <div>
                <label className="label">分类</label>
                <select
                  className="input"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  <option value="">请选择分类</option>
                  {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="label">学历</label>
                <select
                  className="input"
                  value={form.degree}
                  onChange={(e) => setForm({ ...form, degree: e.target.value })}
                >
                  <option value="">未设置</option>
                  <option value="本科">本科</option>
                  <option value="硕士">硕士</option>
                  <option value="博士">博士</option>
                  <option value="其他">其他</option>
                </select>
              </div>
              <div>
                <label className="label">项目描述</label>
                <textarea
                  className="input"
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="服务内容、指导范围等"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">基础价格 (¥)</label>
                  <input
                    type="number"
                    className="input"
                    value={form.base_price}
                    onChange={(e) => setForm({ ...form, base_price: e.target.value })}
                    step="0.01"
                  />
                </div>
                <div>
                  <label className="label">服务时长</label>
                  <input
                    className="input"
                    value={form.duration_text}
                    onChange={(e) => setForm({ ...form, duration_text: e.target.value })}
                    placeholder="如 4 周 / 8 周"
                  />
                </div>
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
              <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-ink">启用</div>
                  <div className="text-xs text-slate-400">停用后前台不展示该项目</div>
                </div>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, is_active: !form.is_active })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${form.is_active ? 'bg-accent' : 'bg-slate-200'}`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${form.is_active ? 'translate-x-5' : 'translate-x-0.5'}`} />
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
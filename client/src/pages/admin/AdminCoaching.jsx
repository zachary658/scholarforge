import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Plus, Edit, Trash, X, Refresh } from '../../components/Icons.jsx';
import { toast } from '../../components/Toast.jsx';
import { useConfirm } from '../../components/ConfirmModal.jsx';

const emptyForm = {
  id: '',
  title: '',
  description: '',
  price: 0,
  duration_text: '',
  degree: '',
  validity_days: '',
  is_active: true,
  sort_order: 0,
  // 自定义报价规则（留空 = 使用全局默认值）
  custom_base_word_count: '',
  custom_word_price: '',
  custom_chart_price: '',
  custom_drawing_price: '',
  custom_formula_low: '',
  custom_formula_mid: '',
  custom_formula_high: '',
  custom_urgent_multiplier: '',
};

const DEGREE_OPTIONS = ['本科', '硕士', '博士', '其他'];

export default function AdminCoaching() {
  const confirm = useConfirm();
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // { mode: 'create' | 'edit' }
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.adminListCourses();
      setCourses(Array.isArray(data.courses) ? data.courses : []);
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

  const openEdit = (c) => {
    setForm({
      id: c.id ?? '',
      title: c.title ?? '',
      description: c.description ?? '',
      price: c.price ?? 0,
      duration_text: c.duration_text ?? '',
      degree: c.degree ?? '',
      validity_days: c.validity_days ?? '',
      is_active: c.is_active !== false,
      sort_order: c.sort_order ?? 0,
      custom_base_word_count: c.custom_base_word_count ?? '',
      custom_word_price: c.custom_word_price ?? '',
      custom_chart_price: c.custom_chart_price ?? '',
      custom_drawing_price: c.custom_drawing_price ?? '',
      custom_formula_low: c.custom_formula_low ?? '',
      custom_formula_mid: c.custom_formula_mid ?? '',
      custom_formula_high: c.custom_formula_high ?? '',
      custom_urgent_multiplier: c.custom_urgent_multiplier ?? '',
    });
    setModal({ mode: 'edit' });
  };

  const close = () => {
    setModal(null);
    setForm(emptyForm);
  };

  const save = async () => {
    if (!form.title.trim()) {
      toast.warning('请填写课程名称');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim(),
        price: Number(form.price) || 0,
        duration_text: form.duration_text.trim(),
        degree: form.degree.trim(),
        validity_days: form.validity_days === '' || form.validity_days == null ? null : Number(form.validity_days),
        is_active: !!form.is_active,
        sort_order: Number(form.sort_order) || 0,
        custom_base_word_count: form.custom_base_word_count === '' ? '' : Number(form.custom_base_word_count),
        custom_word_price: form.custom_word_price === '' ? '' : Number(form.custom_word_price),
        custom_chart_price: form.custom_chart_price === '' ? '' : Number(form.custom_chart_price),
        custom_drawing_price: form.custom_drawing_price === '' ? '' : Number(form.custom_drawing_price),
        custom_formula_low: form.custom_formula_low === '' ? '' : Number(form.custom_formula_low),
        custom_formula_mid: form.custom_formula_mid === '' ? '' : Number(form.custom_formula_mid),
        custom_formula_high: form.custom_formula_high === '' ? '' : Number(form.custom_formula_high),
        custom_urgent_multiplier: form.custom_urgent_multiplier === '' ? '' : Number(form.custom_urgent_multiplier),
      };
      if (modal.mode === 'edit' && form.id) payload.id = form.id;
      await api.adminSaveCourse(payload);
      toast.success(modal.mode === 'create' ? '课程已新增' : '课程已更新');
      close();
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c) => {
    if (!await confirm({
      title: '删除确认',
      message: `确认删除「${c.title}」？此操作不可撤销。`,
      danger: true,
      confirmText: '删除',
    })) return;
    setError('');
    try {
      await api.adminDeleteCourse(c.id);
      toast.success('课程已删除');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">课程管理</h1>
          <p className="mt-1 text-sm text-slate-500">管理论文 1 对 1 指导课程，用户可购买后开通</p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="h-4 w-4" /> 新增课程
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
                <th className="px-4 py-3">课程名称</th>
                <th className="px-4 py-3">价格</th>
                <th className="px-4 py-3">时长</th>
                <th className="px-4 py-3">有效期</th>
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
              ) : courses.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">暂无课程</td>
                </tr>
              ) : (
                courses.map((c) => {
                  const active = c.is_active !== false;
                  return (
                    <tr key={c.id} className="border-b border-slate-100 text-sm last:border-0">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-ink">{c.title || '—'}</span>
                          {c.degree && <span className="rounded bg-accent-50 px-1.5 py-0.5 text-xs text-accent">{c.degree}</span>}
                        </div>
                        {c.description && <div className="mt-0.5 max-w-[320px] truncate text-xs text-slate-400">{c.description}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-700">¥{Number(c.price ?? 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-slate-600">{c.duration_text || '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{c.validity_days ? `${c.validity_days} 天` : '长期'}</td>
                      <td className="px-4 py-3 text-slate-600">{c.sort_order ?? 0}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-md px-2 py-0.5 text-xs ${active ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                          {active ? '启用' : '停用'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-1">
                          <button onClick={() => openEdit(c)} className="btn-ghost text-xs">
                            <Edit className="h-3.5 w-3.5" /> 编辑
                          </button>
                          <button onClick={() => remove(c)} className="btn-ghost text-xs text-red-500 hover:bg-red-50">
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
                {modal.mode === 'create' ? '新增课程' : '编辑课程'}
              </h3>
              <button onClick={close} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-ink">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-5">
              <div>
                <label className="label">课程名称</label>
                <input
                  className="input"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="如 论文 1 对 1 指导（本科）"
                />
              </div>
              <div>
                <label className="label">学历</label>
                <select
                  className="input"
                  value={form.degree}
                  onChange={(e) => setForm({ ...form, degree: e.target.value })}
                >
                  <option value="">未设置</option>
                  {DEGREE_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <p className="mt-1.5 text-xs text-slate-400">前台按学历分组展示课程</p>
              </div>
              <div>
                <label className="label">课程描述</label>
                <textarea
                  className="input"
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="服务内容、导师指导范围等"
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
                  <label className="label">服务时长</label>
                  <input
                    className="input"
                    value={form.duration_text}
                    onChange={(e) => setForm({ ...form, duration_text: e.target.value })}
                    placeholder="如 4 周 / 8 周"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">有效期（天）</label>
                  <input
                    type="number"
                    className="input"
                    value={form.validity_days}
                    onChange={(e) => setForm({ ...form, validity_days: e.target.value })}
                    placeholder="留空表示长期有效"
                  />
                  <p className="mt-1.5 text-xs text-slate-400">购买后多少天内有效，留空 = 长期有效</p>
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

              {/* 自定义报价规则 */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink">自定义报价规则</span>
                  <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500">选填</span>
                </div>
                <p className="mb-4 text-xs text-slate-400">留空则使用全局默认报价规则，填写后将覆盖对应项的全局设置</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">基准字数（字）</label>
                    <input
                      type="number"
                      className="input"
                      value={form.custom_base_word_count}
                      onChange={(e) => setForm({ ...form, custom_base_word_count: e.target.value })}
                      placeholder="默认 10000"
                    />
                  </div>
                  <div>
                    <label className="label">每万字加价（元）</label>
                    <input
                      type="number"
                      className="input"
                      value={form.custom_word_price}
                      onChange={(e) => setForm({ ...form, custom_word_price: e.target.value })}
                      placeholder="默认 500"
                      step="0.01"
                    />
                  </div>
                  <div>
                    <label className="label">每张图表加价（元）</label>
                    <input
                      type="number"
                      className="input"
                      value={form.custom_chart_price}
                      onChange={(e) => setForm({ ...form, custom_chart_price: e.target.value })}
                      placeholder="默认 100"
                      step="0.01"
                    />
                  </div>
                  <div>
                    <label className="label">每张图纸加价（元）</label>
                    <input
                      type="number"
                      className="input"
                      value={form.custom_drawing_price}
                      onChange={(e) => setForm({ ...form, custom_drawing_price: e.target.value })}
                      placeholder="默认 150"
                      step="0.01"
                    />
                  </div>
                  <div>
                    <label className="label">公式-少量加价（元）</label>
                    <input
                      type="number"
                      className="input"
                      value={form.custom_formula_low}
                      onChange={(e) => setForm({ ...form, custom_formula_low: e.target.value })}
                      placeholder="默认 200"
                      step="0.01"
                    />
                  </div>
                  <div>
                    <label className="label">公式-较多加价（元）</label>
                    <input
                      type="number"
                      className="input"
                      value={form.custom_formula_mid}
                      onChange={(e) => setForm({ ...form, custom_formula_mid: e.target.value })}
                      placeholder="默认 500"
                      step="0.01"
                    />
                  </div>
                  <div>
                    <label className="label">公式-大量加价（元）</label>
                    <input
                      type="number"
                      className="input"
                      value={form.custom_formula_high}
                      onChange={(e) => setForm({ ...form, custom_formula_high: e.target.value })}
                      placeholder="默认 1000"
                      step="0.01"
                    />
                  </div>
                  <div>
                    <label className="label">加急倍率</label>
                    <input
                      type="number"
                      className="input"
                      value={form.custom_urgent_multiplier}
                      onChange={(e) => setForm({ ...form, custom_urgent_multiplier: e.target.value })}
                      placeholder="默认 1.3"
                      step="0.01"
                      min="1"
                    />
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-ink">启用</div>
                  <div className="text-xs text-slate-400">停用后前台不展示该课程</div>
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

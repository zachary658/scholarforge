// 创建/编辑论文工作区弹窗（拆分自 pages/Projects.jsx）
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useToast } from '../Toast.jsx';
import { X, Save } from '../Icons.jsx';
import { FIELDS, DEGREES, tsToDate, dateToTs } from '../../lib/projectUtils.js';

export default function ProjectModal({ project, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    title: project?.title || '',
    field: project?.field || '',
    degree: project?.degree || '',
    description: project?.description || '',
    writingRequirements: project?.writing_requirements || '',
    deadline: tsToDate(project?.deadline),
    outline: project?.outline || [],
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error('请填写论文标题');
      return;
    }
    setSaving(true);
    const payload = { ...form, deadline: dateToTs(form.deadline) };
    try {
      if (project) {
        await api.updateProject(project.id, payload);
        toast.success('已保存');
      } else {
        await api.createProject(payload);
        toast.success('工作区已创建');
      }
      onSaved();
    } catch (err) {
      toast.error('保存失败：' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="max-h-[90vh] w-[600px] max-w-full overflow-y-auto rounded-xl bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="font-semibold text-ink">{project ? '编辑工作区' : '新建论文工作区'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          <div>
            <label className="block text-sm font-medium text-ink">论文标题 *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="如：基于深度学习的图像识别研究"
              className="input mt-1.5"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink">学科领域</label>
            <select
              value={form.field}
              onChange={(e) => setForm({ ...form, field: e.target.value })}
              className="input mt-1.5"
            >
              <option value="">请选择</option>
              {FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink">学历</label>
              <select
                value={form.degree}
                onChange={(e) => setForm({ ...form, degree: e.target.value })}
                className="input mt-1.5"
              >
                <option value="">请选择</option>
                {DEGREES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink">截止时间</label>
              <input
                type="date"
                value={form.deadline}
                onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                className="input mt-1.5"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink">论文描述</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="简要描述论文的研究内容和方向…"
              rows={2}
              className="input mt-1.5"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink">写作要求</label>
            <textarea
              value={form.writingRequirements}
              onChange={(e) => setForm({ ...form, writingRequirements: e.target.value })}
              placeholder="如：8000字以上、学术规范、需引用近5年文献…"
              rows={2}
              className="input mt-1.5"
            />
            <p className="mt-1 text-xs text-slate-400">这些要求会作为上下文自动注入到 AI 调用中</p>
          </div>
          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
            <button type="button" onClick={onClose} className="btn-ghost">取消</button>
            <button type="submit" disabled={saving} className="btn-primary">
              <Save className="h-4 w-4" /> {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

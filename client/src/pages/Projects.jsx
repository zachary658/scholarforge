import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmModal.jsx';
import {
  Refresh, Plus, Trash, Edit, Layers, BookOpen, Eye, X,
  Save, ChevronRight, Brain, FileText, Pen, ArrowRight, FileWord,
} from '../components/Icons.jsx';

const FIELDS = [
  '计算机科学', '电子信息', '机械工程', '材料科学', '生物医学',
  '化学', '物理学', '数学', '经济学', '管理学',
  '法学', '文学', '历史学', '哲学', '教育学', '其他',
];

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Projects() {
  const toast = useToast();
  const confirm = useConfirm();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [viewProject, setViewProject] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.listProjects();
      setProjects(d.projects || []);
    } catch (err) {
      toast.error('加载失败：' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: '归档论文工作区',
      message: '归档后工作区不再显示在列表中，但关联的任务记录仍保留。确定要归档吗？',
      confirmText: '归档',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteProject(id);
      toast.success('已归档');
      load();
    } catch (err) {
      toast.error('操作失败：' + err.message);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">论文工作区</h1>
          <p className="mt-1 text-sm text-slate-500">为每篇论文创建独立工作区，AI 调用共享上下文与记忆</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className="btn-ghost text-sm">
            <Refresh className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
          <button onClick={() => setShowCreate(true)} className="btn-primary text-sm">
            <Plus className="h-4 w-4" /> 新建工作区
          </button>
        </div>
      </div>

      {/* 功能说明 */}
      <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/50 p-4">
        <div className="flex items-start gap-3">
          <Brain className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-500" />
          <div className="text-sm text-slate-600">
            <p className="font-medium text-blue-700">AI 记忆如何工作？</p>
            <p className="mt-1 text-xs leading-relaxed">
              在工作区内的所有 AI 调用会自动带入论文信息和大纲作为上下文。例如：先让 AI 生成大纲，再让 AI 写段落时，它会自动"记住"大纲内容，无需手动复制。
              历史调用结果也会作为参考注入（智能截断，不会无限膨胀）。
            </p>
          </div>
        </div>
      </div>

      {/* 工作区列表 */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {loading && projects.length === 0 && (
          <div className="col-span-full card p-8 text-center text-sm text-slate-400">加载中…</div>
        )}
        {!loading && projects.length === 0 && (
          <div className="col-span-full card p-12 text-center">
            <Layers className="mx-auto h-12 w-12 text-slate-300" />
            <p className="mt-3 text-sm text-slate-400">还没有论文工作区</p>
            <p className="mt-1 text-xs text-slate-400">创建工作区后，AI 调用可在该工作区上下文内进行</p>
            <button onClick={() => setShowCreate(true)} className="btn-primary mt-4 text-sm">
              <Plus className="h-4 w-4" /> 创建第一个工作区
            </button>
          </div>
        )}
        {projects.map((p) => (
          <div key={p.id} className="card p-5 hover:shadow-md transition">
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 flex-shrink-0 text-accent" />
                  <h3 className="truncate font-semibold text-ink">{p.title}</h3>
                </div>
                {p.field && (
                  <span className="mt-1.5 inline-block rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    {p.field}
                  </span>
                )}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => setEditingProject(p)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-accent"
                  title="编辑"
                >
                  <Edit className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDelete(p.id)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
                  title="归档"
                >
                  <Trash className="h-4 w-4" />
                </button>
              </div>
            </div>

            {p.description && (
              <p className="mt-2 text-sm text-slate-500 line-clamp-2">{p.description}</p>
            )}

            {p.writing_requirements && (
              <p className="mt-1 text-xs text-slate-400 line-clamp-1">
                <span className="font-medium">写作要求：</span>{p.writing_requirements}
              </p>
            )}

            <div className="mt-3 flex items-center gap-3 text-xs text-slate-400">
              <span>大纲 {p.outline?.length || 0} 章</span>
              <span>·</span>
              <span>{p.task_count || 0} 次调用</span>
              <span>·</span>
              <span>更新于 {fmtDate(p.updated_at)}</span>
            </div>

            <button
              onClick={() => setViewProject(p)}
              className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg border border-slate-200 py-2 text-sm text-accent hover:bg-accent-50"
            >
              进入工作区 <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      {/* 创建/编辑弹窗 */}
      {(showCreate || editingProject) && (
        <ProjectModal
          project={editingProject}
          onClose={() => { setShowCreate(false); setEditingProject(null); }}
          onSaved={() => { setShowCreate(false); setEditingProject(null); load(); }}
        />
      )}

      {/* 工作区详情 */}
      {viewProject && (
        <ProjectDetail
          project={viewProject}
          onClose={() => setViewProject(null)}
          onEdit={() => { setEditingProject(viewProject); setViewProject(null); }}
        />
      )}
    </div>
  );
}

// ========== 创建/编辑工作区弹窗 ==========
function ProjectModal({ project, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    title: project?.title || '',
    field: project?.field || '',
    description: project?.description || '',
    writingRequirements: project?.writing_requirements || '',
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
    try {
      if (project) {
        await api.updateProject(project.id, form);
        toast.success('已保存');
      } else {
        await api.createProject(form);
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

// ========== 工作区详情（全流程 + 大纲 + 任务历史 + 上下文预览） ==========
function ProjectDetail({ project, onClose, onEdit }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState('overview');
  const [tasks, setTasks] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [contextPreview, setContextPreview] = useState(null);
  const [outline, setOutline] = useState(project.outline || []);
  const [savingOutline, setSavingOutline] = useState(false);

  // 借鉴千笔写作：全流程步骤导航（点击跳转到对应工具，并自动带上 projectId）
  const pipelineSteps = [
    { key: 'outline', title: '大纲生成', desc: '免费不限次，3 级结构化大纲', icon: Layers, to: '/app/writing', free: true },
    { key: 'paragraph', title: '段落/全文', desc: '基于大纲撰写正文段落', icon: FileWord, to: '/app/writing' },
    { key: 'literature', title: '文献综述', desc: '主题分类梳理+真实文献引用', icon: BookOpen, to: '/app/literature-review' },
    { key: 'rewrite', title: '论文降重', desc: '同义改写降低重复率', icon: Refresh, to: '/app/rewrite' },
    { key: 'ai_reduce', title: '降AI率', desc: '一键改写消除AI痕迹', icon: Refresh, to: '/app/ai-reduce' },
    { key: 'defense', title: '答辩PPT', desc: '生成答辩PPT+演讲稿', icon: FileWord, to: '/app/defense' },
  ];

  // 根据已有任务判断每个步骤是否已完成
  const completedTools = new Set(tasks.map((t) => t.tool_type));

  const goStep = (step) => {
    const params = new URLSearchParams();
    params.set('projectId', project.id);
    if (step.key === 'outline') params.set('type', 'outline');
    if (step.key === 'paragraph') params.set('type', 'paragraph');
    navigate(`${step.to}?${params.toString()}`);
  };

  const loadTasks = useCallback(async () => {
    setLoadingTasks(true);
    try {
      const d = await api.listProjectTasks(project.id, { page: 1, size: 50 });
      setTasks(d.tasks || []);
    } catch (err) {
      toast.error('加载任务失败：' + err.message);
    } finally {
      setLoadingTasks(false);
    }
  }, [project.id]);

  const loadContext = useCallback(async () => {
    try {
      const d = await api.previewProjectContext(project.id, {});
      setContextPreview(d);
    } catch (err) {
      toast.error('加载上下文失败：' + err.message);
    }
  }, [project.id]);

  useEffect(() => {
    if (tab === 'tasks') loadTasks();
    if (tab === 'context') loadContext();
  }, [tab, loadTasks, loadContext]);

  const handleSaveOutline = async () => {
    setSavingOutline(true);
    try {
      await api.updateProject(project.id, { outline });
      toast.success('大纲已保存');
    } catch (err) {
      toast.error('保存失败：' + err.message);
    } finally {
      setSavingOutline(false);
    }
  };

  const addChapter = () => {
    setOutline([...outline, { chapter: `第${outline.length + 1}章 新章节`, sections: [] }]);
  };
  const updateChapter = (i, val) => {
    const next = [...outline];
    next[i] = { ...next[i], chapter: val };
    setOutline(next);
  };
  const addSection = (ci) => {
    const next = [...outline];
    next[ci] = { ...next[ci], sections: [...(next[ci].sections || []), { title: '新小节', content: '' }] };
    setOutline(next);
  };
  const updateSection = (ci, si, field, val) => {
    const next = [...outline];
    next[ci].sections[si] = { ...next[ci].sections[si], [field]: val };
    setOutline(next);
  };
  const removeChapter = (i) => {
    setOutline(outline.filter((_, idx) => idx !== i));
  };
  const removeSection = (ci, si) => {
    const next = [...outline];
    next[ci].sections = next[ci].sections.filter((_, idx) => idx !== si);
    setOutline(next);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex max-h-[90vh] w-[800px] max-w-full flex-col rounded-xl bg-white shadow-card">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-accent" />
            <h3 className="font-semibold text-ink">{project.title}</h3>
            {project.field && (
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{project.field}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onEdit} className="btn-ghost text-xs">
              <Edit className="h-3.5 w-3.5" /> 编辑
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
          </div>
        </div>

        {/* Tab */}
        <div className="flex gap-1 border-b border-slate-100 px-6">
          {[
            { key: 'overview', label: '概览' },
            { key: 'pipeline', label: '全流程' },
            { key: 'outline', label: '大纲管理' },
            { key: 'tasks', label: `任务历史 (${tasks.length})` },
            { key: 'context', label: '上下文预览' },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                tab === t.key ? 'border-accent text-accent' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === 'overview' && (
            <div className="space-y-4">
              {project.description && (
                <div>
                  <h4 className="text-sm font-semibold text-ink">论文描述</h4>
                  <p className="mt-1.5 text-sm text-slate-600">{project.description}</p>
                </div>
              )}
              {project.writing_requirements && (
                <div>
                  <h4 className="text-sm font-semibold text-ink">写作要求</h4>
                  <p className="mt-1.5 text-sm text-slate-600">{project.writing_requirements}</p>
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-slate-50 p-4 text-center">
                  <div className="text-2xl font-bold text-accent">{outline.length}</div>
                  <div className="text-xs text-slate-500">大纲章节</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-4 text-center">
                  <div className="text-2xl font-bold text-accent">{tasks.length || project.task_count || 0}</div>
                  <div className="text-xs text-slate-500">AI 调用次数</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-4 text-center">
                  <div className="text-2xl font-bold text-accent">{fmtDate(project.updated_at).slice(5, 10)}</div>
                  <div className="text-xs text-slate-500">最后更新</div>
                </div>
              </div>
              <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4 text-sm text-slate-600">
                <p className="flex items-center gap-2 font-medium text-blue-700">
                  <Brain className="h-4 w-4" /> 使用提示
                </p>
                <p className="mt-1.5 text-xs leading-relaxed">
                  在使用 AI 写作、润色、降重等工具时，选择关联到此工作区，AI 会自动带入论文信息、大纲和历史调用结果作为上下文。
                </p>
              </div>
              {/* 快捷入口到全流程 */}
              <button
                onClick={() => setTab('pipeline')}
                className="flex w-full items-center justify-between rounded-lg border border-accent-100 bg-accent-50/50 px-4 py-3 text-sm text-accent hover:bg-accent-50"
              >
                <span className="flex items-center gap-2">
                  <Layers className="h-4 w-4" /> 查看写作全流程步骤
                </span>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {tab === 'pipeline' && (
            <div>
              <div className="mb-4 flex items-center gap-2">
                <Layers className="h-4 w-4 text-accent" />
                <h4 className="text-sm font-semibold text-ink">写作全流程</h4>
                <span className="text-xs text-slate-400">点击任意步骤直接进入对应工具，自动关联本工作区</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {pipelineSteps.map((step, i) => {
                  const done = completedTools.has(step.key === 'outline' ? 'writing' : step.key === 'paragraph' ? 'writing' : step.key);
                  return (
                    <button
                      key={step.key}
                      onClick={() => goStep(step)}
                      className="group flex items-start gap-3 rounded-lg border border-slate-200 p-4 text-left transition hover:border-accent hover:bg-accent-50/40"
                    >
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 group-hover:bg-accent-50 group-hover:text-accent">
                        <step.icon className="h-[18px] w-[18px]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-400">步骤 {i + 1}</span>
                          {step.free && (
                            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">免费</span>
                          )}
                          {done && (
                            <span className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-600">已尝试</span>
                          )}
                        </div>
                        <h5 className="mt-0.5 text-sm font-semibold text-ink">{step.title}</h5>
                        <p className="mt-0.5 text-xs text-slate-500">{step.desc}</p>
                      </div>
                      <ArrowRight className="mt-2 h-4 w-4 flex-shrink-0 text-slate-300 group-hover:text-accent" />
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50/40 p-3 text-xs text-emerald-700">
                <Brain className="mr-1 inline h-3.5 w-3.5" />
                全流程中所有 AI 调用都会自动记忆到本工作区，下次调用会带上之前的上下文，无需手动复制内容。
              </div>
            </div>
          )}

          {tab === 'outline' && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm text-slate-500">管理论文章节大纲，作为 AI 写作的上下文</p>
                <div className="flex gap-2">
                  <button onClick={addChapter} className="btn-ghost text-xs">
                    <Plus className="h-3.5 w-3.5" /> 添加章节
                  </button>
                  <button onClick={handleSaveOutline} disabled={savingOutline} className="btn-primary text-xs">
                    <Save className="h-3.5 w-3.5" /> {savingOutline ? '保存中…' : '保存大纲'}
                  </button>
                </div>
              </div>
              {outline.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center">
                  <FileText className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-2 text-sm text-slate-400">还没有大纲，点击"添加章节"开始</p>
                </div>
              )}
              <div className="space-y-3">
                {outline.map((ch, ci) => (
                  <div key={ci} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={ch.chapter || ch.title || ''}
                        onChange={(e) => updateChapter(ci, e.target.value)}
                        className="input flex-1 font-medium"
                        placeholder="章节标题"
                      />
                      <button onClick={() => removeChapter(ci)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500">
                        <Trash className="h-4 w-4" />
                      </button>
                    </div>
                    {(ch.sections || []).map((sec, si) => (
                      <div key={si} className="mt-2 flex items-start gap-2 pl-4">
                        <span className="mt-2 text-slate-300">└</span>
                        <input
                          type="text"
                          value={sec.title || ''}
                          onChange={(e) => updateSection(ci, si, 'title', e.target.value)}
                          className="input flex-1 text-sm"
                          placeholder="小节标题"
                        />
                        <input
                          type="text"
                          value={sec.content || ''}
                          onChange={(e) => updateSection(ci, si, 'content', e.target.value)}
                          className="input flex-1 text-sm"
                          placeholder="简述（可选）"
                        />
                        <button onClick={() => removeSection(ci, si)} className="mt-1 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    <button onClick={() => addSection(ci)} className="mt-2 ml-4 text-xs text-accent hover:underline">
                      + 添加小节
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'tasks' && (
            <div>
              {loadingTasks ? (
                <p className="text-center text-sm text-slate-400">加载中…</p>
              ) : tasks.length === 0 ? (
                <div className="text-center py-8">
                  <FileText className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-2 text-sm text-slate-400">此工作区还没有 AI 调用记录</p>
                  <p className="mt-1 text-xs text-slate-400">使用 AI 工具时选择关联到此工作区即可</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {tasks.map((t) => (
                    <div key={t.id} className="rounded-lg border border-slate-100 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-ink truncate">{t.title}</span>
                        <span className="text-xs text-slate-400">{fmtDate(t.created_at)}</span>
                      </div>
                      {t.output_preview && (
                        <p className="mt-1 text-xs text-slate-500 line-clamp-2">{t.output_preview}</p>
                      )}
                      <div className="mt-1.5 flex gap-2 text-xs text-slate-400">
                        <span>{t.tool_type}</span>
                        <span>·</span>
                        <span>{t.tokens || 0} tokens</span>
                        <span>·</span>
                        <span>输出 {t.output_len || 0} 字</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'context' && (
            <div>
              <p className="mb-3 text-sm text-slate-500">
                以下是 AI 调用时会自动带入的上下文（基于论文信息+大纲+历史任务智能组装）：
              </p>
              {!contextPreview ? (
                <p className="text-center text-sm text-slate-400">加载中…</p>
              ) : (
                <>
                  <div className="mb-3 flex items-center gap-3 text-xs">
                    <span className="rounded bg-blue-50 px-2 py-1 text-blue-600">
                      上下文摘要：{contextPreview.summary || '（无）'}
                    </span>
                    <span className="rounded bg-slate-100 px-2 py-1 text-slate-500">
                      {contextPreview.chars} 字符
                    </span>
                  </div>
                  <pre className="max-h-[400px] overflow-y-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100 whitespace-pre-wrap">
                    {contextPreview.context || '（暂无上下文，请先填写论文信息或大纲）'}
                  </pre>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

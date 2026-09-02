import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmModal.jsx';
import FeaturePay from '../components/FeaturePay.jsx';
import AcademicIntegrityModal from '../components/AcademicIntegrityModal.jsx';
import { useAcademicIntegrity } from '../lib/useAcademicIntegrity.js';
import {
  Refresh, Plus, Trash, Edit, Layers, BookOpen, Eye, X,
  Save, ChevronRight, Brain, FileText, Pen, ArrowRight, FileWord, Check, Book,
} from '../components/Icons.jsx';
import { PAPER_STAGES } from '../lib/constants.js';

const FIELDS = [
  '计算机科学', '电子信息', '机械工程', '材料科学', '生物医学',
  '化学', '物理学', '数学', '经济学', '管理学',
  '法学', '文学', '历史学', '哲学', '教育学', '其他',
];

const DEGREES = ['本科', '硕士', '博士', '其他'];

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 截止时间：Unix 秒级时间戳 ↔ <input type="date"> 的 YYYY-MM-DD 互转
function tsToDate(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dateToTs(dateStr) {
  if (!dateStr) return null;
  const t = new Date(`${dateStr}T23:59:59`).getTime() / 1000;
  return Number.isFinite(t) ? Math.floor(t) : null;
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
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {p.field && (
                    <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                      {p.field}
                    </span>
                  )}
                  {p.degree && (
                    <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                      {p.degree}
                    </span>
                  )}
                  {p.deadline && (
                    <span className="inline-block rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-600">
                      截止 {tsToDate(p.deadline)}
                    </span>
                  )}
                </div>
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

// ========== 工作区详情（全流程 + 大纲 + 任务历史 + 上下文预览） ==========
function ProjectDetail({ project, onClose, onEdit }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState('pipeline'); // 默认展示主流程步骤导航
  const [tasks, setTasks] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [materials, setMaterials] = useState([]);
  const [outline, setOutline] = useState(project.outline || []);
  const [savingOutline, setSavingOutline] = useState(false);
  const [confirmedAt, setConfirmedAt] = useState(project.outline_confirmed_at || null);
  const [chapters, setChapters] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [needPay, setNeedPay] = useState(null);
  const [merging, setMerging] = useState(false);
  // 合并导出用的格式模板（可选：高校/自定义模板，与写作类导出一致）
  const [templates, setTemplates] = useState([]);
  const [mergeTemplateId, setMergeTemplateId] = useState('');
  useEffect(() => {
    api.listTemplates().then((d) => setTemplates(d.templates || [])).catch(() => {});
  }, []);
  const integrity = useAcademicIntegrity();
  // 轮询定时器：用 ref 管理，防重复创建 interval；组件卸载时清理（此前存在内存泄漏）
  const pollRef = useRef(null);
  const pollInFlightRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  // P1-4 论文主流程步骤导航：把每个阶段映射到具体工具入口（点击自动带上 projectId）
  const STAGE_NAV = {
    materials: { to: '/app/writing' },
    outline: { to: '/app/writing', type: 'outline' },
    literature: { to: '/app/literature-review' },
    writing: { to: '/app/writing', type: 'paragraph' },
    review: { to: '/app/rewrite' },
    defense: { to: '/app/defense' },
  };

  const currentStageIdx = Math.max(0, PAPER_STAGES.findIndex((s) => s.key === (project.current_stage || 'create')));

  // 每一步的完成状态：优先用实际产物判定，其次回退到 current_stage 位置
  const stageStatus = (stage, i) => {
    const dataDone = {
      create: true,
      materials: materials.length > 0,
      outline: outline.length > 0,
      literature: tasks.some((t) => t.tool_type === 'literature_review'),
      writing: chapters.length > 0,
      review: tasks.some((t) => t.tool_type === 'rewrite' || t.tool_type === 'ai_reduce'),
      defense: tasks.some((t) => t.tool_type === 'defense'),
      export: false,
    }[stage.key];
    if (dataDone) return 'done';
    if (i === currentStageIdx) return 'current';
    return 'pending';
  };

  const goStage = (stage) => {
    if (stage.key === 'create') { onEdit(); return; }
    if (stage.key === 'export') { setTab('chapters'); return; }
    const nav = STAGE_NAV[stage.key];
    if (!nav) return;
    const params = new URLSearchParams();
    params.set('projectId', project.id);
    if (nav.type) params.set('type', nav.type);
    navigate(`${nav.to}?${params.toString()}`);
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

  // 我的资料（本工作区上传的参考材料）
  const loadMaterials = useCallback(async () => {
    try {
      const d = await api.listMaterials({ projectId: project.id });
      setMaterials(d.materials || []);
    } catch (err) {
      toast.error('加载资料失败：' + err.message);
    }
  }, [project.id]);

  const loadChapters = useCallback(async () => {
    try {
      const d = await api.getChapters(project.id);
      setChapters(d.chapters || []);
      setGenerating(!!d.generating);
      if (d.outline_confirmed_at) setConfirmedAt(d.outline_confirmed_at);
    } catch (err) {
      toast.error('加载章节失败：' + err.message);
    }
  }, [project.id]);

  // 刷新工作区大纲：大纲生成/深度调研后自动写入结构化大纲，进入此 tab 时拉取最新
  const loadProject = useCallback(async () => {
    try {
      const d = await api.getProject(project.id);
      setOutline(d.project?.outline || []);
      if (d.project?.outline_confirmed_at) setConfirmedAt(d.project.outline_confirmed_at);
    } catch (err) {
      toast.error('加载大纲失败：' + err.message);
    }
  }, [project.id]);

  useEffect(() => {
    if (tab === 'tasks') loadTasks();
    if (tab === 'materials') loadMaterials();
    if (tab === 'chapters') loadChapters();
    if (tab === 'outline') loadProject();
    if (tab === 'pipeline') { loadTasks(); loadMaterials(); loadChapters(); }
  }, [tab, loadTasks, loadMaterials, loadChapters, loadProject]);

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

  const handleConfirmOutline = async () => {
    try {
      await api.confirmOutline(project.id);
      setConfirmedAt(Math.floor(Date.now() / 1000));
      toast.success('大纲已确认，可开始生成正文');
    } catch (err) {
      toast.error('确认失败：' + err.message);
    }
  };

  const doGenerate = async (orderNo) => {
    setGenerating(true);
    try {
      await api.generateChapters(project.id, orderNo ? { orderNo } : {});
      await loadChapters();
      // 防重入：已有轮询则复用，避免多次点击产生多个并行 interval
      if (pollRef.current) return;
      pollRef.current = setInterval(async () => {
        if (pollInFlightRef.current) return;
        pollInFlightRef.current = true;
        try {
          const d = await api.getChapters(project.id);
          setChapters(d.chapters || []);
          setGenerating(!!d.generating);
          if (!d.generating) { stopPolling(); toast.success('章节生成完成'); }
        } catch { stopPolling(); }
        finally { pollInFlightRef.current = false; }
      }, 3000);
    } catch (err) {
      // 402 契约：后端返回 { error, needOrder, itemType, amount }，api.js 将其放入 err.data
      const nd = err?.data?.needOrder;
      if (nd) {
        setNeedPay({ itemType: err.data.itemType || 'writing_fulltext', amount: Number(err.data.amount || 0) });
      } else {
        toast.error(err.message);
      }
      setGenerating(false);
    }
  };

  const doRegenerate = async (chapterId) => {
    try {
      await api.regenerateChapter(project.id, chapterId, {});
      await loadChapters();
      toast.success('已提交重新生成');
    } catch (err) {
      const nd = err?.data?.needOrder;
      if (nd) setNeedPay({ itemType: err.data.itemType || 'writing_fulltext', amount: Number(err.data.amount || 0) });
      else toast.error(err.message);
    }
  };

  const saveChapter = async (chapterId, content) => {
    try {
      await api.editChapter(project.id, chapterId, content);
      toast.success('章节已保存');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const doMerge = async () => {
    setMerging(true);
    try {
      const data = await api.mergeChapters(project.id, { template_id: mergeTemplateId || undefined });
      if (data.doc?.id) {
        const { downloadDocFile } = await import('../lib/api.js');
        // await 使下载异常能被下方外层 catch 捕获并 toast 提示
        await downloadDocFile(data.doc.id, project.title);
      }
      toast.success('已生成 Word');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setMerging(false);
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

        {/* Tab：主流程步骤导航 + 成果存放区（生成记录/大纲/章节/资料） */}
        <div className="flex gap-1 border-b border-slate-100 px-6">
          {[
            { key: 'pipeline', label: '流程' },
            { key: 'tasks', label: `生成记录 (${tasks.length})` },
            { key: 'outline', label: '大纲' },
            { key: 'chapters', label: '章节内容' },
            { key: 'materials', label: '我的资料' },
            { key: 'overview', label: '概览' },
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
          {tab === 'pipeline' && (
            <div className="space-y-4">
              {/* 系统进度（由已完成任务/产物自动推导）优先，用户手工 completion_percent 作为补充标记 */}
              <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
                    <Brain className="h-4 w-4" /> 论文进度
                  </div>
                  <span className="text-xs text-slate-500">
                    {project.deadline ? `截止 ${tsToDate(project.deadline)}` : '未设置截止时间'}
                  </span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-blue-100">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all"
                    style={{ width: `${Math.min(100, project.system_progress ?? (project.completion_percent > 0 ? project.completion_percent : Math.round(((currentStageIdx + 1) / PAPER_STAGES.length) * 100)))}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  系统进度 <strong>{project.system_progress ?? 0}%</strong>
                  {project.completion_percent > 0 && ` · 手动标记 ${project.completion_percent}%`}
                  {' · '}当前阶段：{PAPER_STAGES[currentStageIdx]?.label || '创建论文'}
                </p>
              </div>

              {/* 步骤导航：每步展示输入要求、完成状态与下一步入口 */}
              <div className="space-y-2">
                {PAPER_STAGES.map((stage, i) => {
                  const status = stageStatus(stage, i);
                  return (
                    <div
                      key={stage.key}
                      className={`flex items-start gap-3 rounded-lg border p-3 ${
                        status === 'done' ? 'border-green-100 bg-green-50/40' :
                        status === 'current' ? 'border-accent/30 bg-accent-50/40' :
                        'border-slate-100 bg-white'
                      }`}
                    >
                      <div className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                        status === 'done' ? 'bg-green-500 text-white' :
                        status === 'current' ? 'bg-accent text-white' :
                        'bg-slate-100 text-slate-400'
                      }`}>
                        {status === 'done' ? <Check className="h-3.5 w-3.5" /> : i + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-ink">{stage.label}</span>
                          <span className={`rounded px-1.5 py-0.5 text-xs ${
                            status === 'done' ? 'bg-green-100 text-green-600' :
                            status === 'current' ? 'bg-accent/10 text-accent' :
                            'bg-slate-100 text-slate-400'
                          }`}>
                            {status === 'done' ? '已完成' : status === 'current' ? '进行中' : '未开始'}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">{stage.desc}</p>
                      </div>
                      <button
                        onClick={() => goStage(stage)}
                        className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                          status === 'done' ? 'btn-ghost' : 'btn-primary !py-1.5'
                        }`}
                      >
                        {stage.key === 'create' ? '编辑信息' :
                         stage.key === 'export' ? '去导出' :
                         status === 'done' ? '重做' : '去完成'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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
              {(project.degree || project.deadline || project.current_stage) && (
                <div className="rounded-lg bg-slate-50 p-4">
                  <h4 className="text-sm font-semibold text-ink">基本信息</h4>
                  <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
                    {project.degree && <span>学历：{project.degree}</span>}
                    {project.deadline && <span>截止：{tsToDate(project.deadline)}</span>}
                    {project.current_stage && (
                      <span>当前阶段：{PAPER_STAGES.find((s) => s.key === project.current_stage)?.label || project.current_stage}</span>
                    )}
                  </div>
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
              {/* 写作流程入口提示：写作在 AI 写作区进行，本区仅存放成果 */}
              <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4 text-sm text-slate-600">
                <p className="flex items-center gap-2 font-medium text-blue-700">
                  <Brain className="h-4 w-4" /> 使用提示
                </p>
                <p className="mt-1.5 text-xs leading-relaxed">
                  论文写作请在「AI 写作」区层层推进（上传资料 → 生成大纲 → 分章节/全文）；本工作区用于存放历次生成成果，可在「生成记录 / 大纲 / 章节内容」中随时回看与下载。
                </p>
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
                  <button onClick={handleSaveOutline} disabled={savingOutline} className="btn-secondary text-xs">
                    <Save className="h-3.5 w-3.5" /> {savingOutline ? '保存中…' : '保存大纲'}
                  </button>
                  <button onClick={handleConfirmOutline} className="btn-primary text-xs">
                    <Check className="h-3.5 w-3.5" /> {confirmedAt ? '重新确认' : '确认大纲'}
                  </button>
                </div>
              </div>
              {confirmedAt && (
                <div className="mb-2 rounded-md bg-green-50 px-3 py-2 text-xs text-green-600">
                  大纲已确认，可开始「分章节生成」或「全文生成」
                </div>
              )}
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

          {tab === 'chapters' && (
            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-slate-500">按已确认大纲逐章生成论文，可局部重写或编辑后继续</p>
                <div className="flex gap-2">
                  <button onClick={loadChapters} className="btn-ghost text-xs">
                    <Refresh className="h-3.5 w-3.5" /> 刷新
                  </button>
                  <button
                    onClick={() => { if (!integrity.ensure(() => doGenerate())) return; doGenerate(); }}
                    disabled={generating}
                    className="btn-primary text-xs"
                  >
                    <Refresh className={`h-3.5 w-3.5 ${generating ? 'animate-spin' : ''}`} />
                    {generating ? '生成中…' : '生成全部章节'}
                  </button>
                  {chapters.length > 0 && (
                    <div className="flex items-center gap-2">
                      <select
                        className="input !w-auto !py-1.5 text-xs"
                        value={mergeTemplateId}
                        onChange={(e) => setMergeTemplateId(e.target.value)}
                        title="合并导出应用的格式模板"
                      >
                        <option value="">默认学术格式</option>
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                      <button onClick={doMerge} disabled={merging} className="btn-secondary text-xs">
                        <FileWord className="h-3.5 w-3.5" /> {merging ? '导出中…' : '合并导出 Word'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {chapters.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center">
                  <FileText className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-2 text-sm text-slate-400">确认大纲后，点击「生成全部章节」开始</p>
                </div>
              )}
              <div className="space-y-3">
                {chapters.map((ch) => (
                  <div key={ch.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink">{ch.chapter}</span>
                      <span className={`rounded px-2 py-0.5 text-xs ${
                        ch.status === 'done' ? 'bg-green-50 text-green-600' :
                        ch.status === 'processing' ? 'bg-blue-50 text-blue-600' :
                        ch.status === 'failed' ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {ch.status === 'done' ? '已完成' : ch.status === 'processing' ? '生成中' : ch.status === 'failed' ? '失败' : '待生成'}
                      </span>
                      {ch.status === 'done' && (
                        <button onClick={() => { if (!integrity.ensure(() => doRegenerate(ch.id))) return; doRegenerate(ch.id); }} className="ml-auto text-xs text-accent hover:underline">重新生成</button>
                      )}
                    </div>
                    <textarea
                      className="input mt-2 min-h-[120px] resize-y text-sm"
                      value={ch.content || ''}
                      onChange={(e) => setChapters((prev) => prev.map((c) => c.id === ch.id ? { ...c, content: e.target.value } : c))}
                      placeholder="本章内容…"
                    />
                    <div className="mt-2 flex justify-end">
                      <button onClick={() => saveChapter(ch.id, ch.content)} className="btn-ghost text-xs">
                        <Save className="h-3.5 w-3.5" /> 保存
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {needPay && (
                <FeaturePay
                  needOrder={needPay}
                  onPaid={(orderNo) => { setNeedPay(null); doGenerate(orderNo); }}
                  onClose={() => setNeedPay(null)}
                />
              )}
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

          {tab === 'materials' && (
            <div>
              <p className="mb-3 text-sm text-slate-500">本工作区上传的参考材料（在 AI 写作区上传时关联本工作区，生成内容可参考这些资料）</p>
              {materials.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
                  暂无资料。前往「AI 写作 → 论文写作」上传资料（docx / pdf / txt），生成时内容将参考你的资料
                </div>
              ) : (
                <div className="space-y-2">
                  {materials.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 rounded-lg border border-slate-100 px-4 py-3">
                      <Book className="h-4 w-4 shrink-0 text-slate-400" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-ink">{m.name}</div>
                        <div className="mt-0.5 text-xs text-slate-400">
                          {m.file_type?.toUpperCase()} · {m.tokens} tokens · 上传于 {fmtDate(m.created_at)}
                        </div>
                      </div>
                      <button
                        onClick={() => navigate(`/app/writing?projectId=${project.id}`)}
                        className="btn-ghost shrink-0 px-3 py-1.5 text-xs"
                      >
                        去写作区使用 →
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {integrity.show && (
        <AcademicIntegrityModal onAgreed={integrity.handleAgreed} onCancel={integrity.close} />
      )}
    </div>
  );
}

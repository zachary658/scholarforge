// 论文工作区列表页：卡片列表 + 创建/编辑弹窗 + 详情入口。
// 详情（ProjectDetail）、数据 hook（useProjectDetail）与各 tab 面板拆分至 components/projects/ 与 lib/。
import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmModal.jsx';
import ProjectModal from '../components/projects/ProjectModal.jsx';
import ProjectDetail from '../components/projects/ProjectDetail.jsx';
import {
  Refresh, Plus, Trash, Edit, Layers, BookOpen,
  ChevronRight, Brain,
} from '../components/Icons.jsx';
import { fmtDate, tsToDate } from '../lib/projectUtils.js';

export default function Projects() {
  const toast = useToast();
  const confirm = useConfirm();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [viewProject, setViewProject] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const targetProjectId = Number(searchParams.get('projectId'));
  const targetTab = searchParams.get('tab') || 'pipeline';

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

  // 流程页可直接把用户带到指定工作区和指定步骤，避免返回列表后再次寻找、点选。
  useEffect(() => {
    const id = targetProjectId;
    if (!id || projects.length === 0) return;
    const target = projects.find((project) => Number(project.id) === id);
    if (target && Number(viewProject?.id) !== id) setViewProject(target);
  }, [projects, targetProjectId, viewProject?.id]);

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
          initialTab={targetTab}
          onClose={() => { setViewProject(null); setSearchParams({}); }}
          onEdit={() => { setEditingProject(viewProject); setViewProject(null); }}
        />
      )}
    </div>
  );
}

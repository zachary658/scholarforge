// 工作区详情（全流程 + 大纲 + 任务历史 + 上下文预览）
// 拆分自 pages/Projects.jsx：数据与状态操作集中在 lib/useProjectDetail.js，各 tab 面板在 ./tabs/。
import { BookOpen, Edit, X } from '../Icons.jsx';
import AcademicIntegrityModal from '../AcademicIntegrityModal.jsx';
import { useProjectDetail } from '../../lib/useProjectDetail.js';
import PipelineTab from './tabs/PipelineTab.jsx';
import OverviewTab from './tabs/OverviewTab.jsx';
import OutlineTab from './tabs/OutlineTab.jsx';
import ChaptersTab from './tabs/ChaptersTab.jsx';
import TasksTab from './tabs/TasksTab.jsx';
import MaterialsTab from './tabs/MaterialsTab.jsx';
import ArtifactsTab from './tabs/ArtifactsTab.jsx';
import EvidenceTab from './tabs/EvidenceTab.jsx';

export default function ProjectDetail({ project, onClose, onEdit, initialTab = 'pipeline' }) {
  const d = useProjectDetail({ project, onEdit, initialTab });

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
        <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-6">
          {[
            { key: 'pipeline', label: '流程' },
            { key: 'tasks', label: `生成记录 (${d.tasks.length})` },
            { key: 'outline', label: '大纲' },
            { key: 'chapters', label: '章节内容' },
            { key: 'artifacts', label: `成果文件 (${d.artifacts.length})` },
            { key: 'evidence', label: `文献与图表 (${d.references.length + d.charts.length})` },
            { key: 'materials', label: '我的资料' },
            { key: 'overview', label: '概览' },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => d.setTab(t.key)}
              className={`border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                d.tab === t.key ? 'border-accent text-accent' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {d.tab === 'pipeline' && <PipelineTab project={project} d={d} />}
          {d.tab === 'overview' && <OverviewTab project={project} d={d} />}
          {d.tab === 'outline' && <OutlineTab d={d} />}
          {d.tab === 'chapters' && <ChaptersTab d={d} />}
          {d.tab === 'tasks' && <TasksTab d={d} />}
          {d.tab === 'materials' && <MaterialsTab project={project} d={d} />}
          {d.tab === 'artifacts' && <ArtifactsTab d={d} />}
          {d.tab === 'evidence' && <EvidenceTab project={project} d={d} />}
        </div>
      </div>
      {d.integrity.show && (
        <AcademicIntegrityModal onAgreed={d.integrity.handleAgreed} onCancel={d.integrity.close} />
      )}
    </div>
  );
}

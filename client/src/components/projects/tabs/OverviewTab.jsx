// 概览 tab：论文描述/写作要求/基本信息与统计
import { Brain } from '../../Icons.jsx';
import { PAPER_STAGES } from '../../../lib/constants.js';
import { tsToDate, fmtDate } from '../../../lib/projectUtils.js';

export default function OverviewTab({ project, d }) {
  return (
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
          <div className="text-2xl font-bold text-accent">{d.outline.length}</div>
          <div className="text-xs text-slate-500">大纲章节</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-4 text-center">
          <div className="text-2xl font-bold text-accent">{d.tasks.length || project.task_count || 0}</div>
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
  );
}

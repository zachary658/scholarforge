// 流程 tab：论文主流程步骤导航（每步展示输入要求、完成状态与下一步入口）
import { Brain, Check } from '../../Icons.jsx';
import { PAPER_STAGES } from '../../../lib/constants.js';
import { tsToDate } from '../../../lib/projectUtils.js';

export default function PipelineTab({ project, d }) {
  return (
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
            style={{ width: `${Math.min(100, project.system_progress ?? (project.completion_percent > 0 ? project.completion_percent : Math.round(((d.currentStageIdx + 1) / PAPER_STAGES.length) * 100)))}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          系统进度 <strong>{project.system_progress ?? 0}%</strong>
          {project.completion_percent > 0 && ` · 手动标记 ${project.completion_percent}%`}
          {' · '}当前阶段：{PAPER_STAGES[d.currentStageIdx]?.label || '创建论文'}
        </p>
      </div>

      {/* 步骤导航：每步展示输入要求、完成状态与下一步入口 */}
      <div className="space-y-2">
        {PAPER_STAGES.map((stage, i) => {
          const status = d.stageStatus(stage, i);
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
                onClick={() => d.goStage(stage)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  status === 'done' ? 'btn-ghost' : 'btn-primary !py-1.5'
                }`}
              >
                {stage.key === 'create' ? '编辑信息' :
                 stage.key === 'outline' && d.outline.length > 0 && !d.confirmedAt ? '去确认' :
                 stage.key === 'export' ? '去导出' :
                 status === 'done' ? '重做' : '去完成'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

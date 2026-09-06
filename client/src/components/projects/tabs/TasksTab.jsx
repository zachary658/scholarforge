// 生成记录 tab：本工作区的 AI 调用历史
import { FileText } from '../../Icons.jsx';
import { fmtDate } from '../../../lib/projectUtils.js';

export default function TasksTab({ d }) {
  return (
    <div>
      {d.loadingTasks ? (
        <p className="text-center text-sm text-slate-400">加载中…</p>
      ) : d.tasks.length === 0 ? (
        <div className="text-center py-8">
          <FileText className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm text-slate-400">此工作区还没有 AI 调用记录</p>
          <p className="mt-1 text-xs text-slate-400">使用 AI 工具时选择关联到此工作区即可</p>
        </div>
      ) : (
        <div className="space-y-2">
          {d.tasks.map((t) => (
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
  );
}

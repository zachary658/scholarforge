// 我的资料 tab：本工作区上传的参考材料
import { Book } from '../../Icons.jsx';
import { fmtDate } from '../../../lib/projectUtils.js';

export default function MaterialsTab({ project, d }) {
  return (
    <div>
      <p className="mb-3 text-sm text-slate-500">本工作区上传的参考材料（在 AI 写作区上传时关联本工作区，生成内容可参考这些资料）</p>
      {d.materials.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
          暂无资料。前往「AI 写作 → 论文写作」上传资料（docx / pdf / txt），生成时内容将参考你的资料
        </div>
      ) : (
        <div className="space-y-2">
          {d.materials.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-lg border border-slate-100 px-4 py-3">
              <Book className="h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">{m.name}</div>
                <div className="mt-0.5 text-xs text-slate-400">
                  {m.file_type?.toUpperCase()} · {m.tokens} tokens · 上传于 {fmtDate(m.created_at)}
                </div>
              </div>
              <button
                onClick={() => d.navigate(`/app/writing?projectId=${project.id}`)}
                className="btn-ghost shrink-0 px-3 py-1.5 text-xs"
              >
                去写作区使用 →
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

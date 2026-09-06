// 大纲 tab：管理论文章节大纲（增删改章节/小节、保存与确认）
import { Plus, Save, Check, Trash, X, FileText } from '../../Icons.jsx';

export default function OutlineTab({ d }) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-slate-500">管理论文章节大纲，作为 AI 写作的上下文</p>
        <div className="flex gap-2">
          <button onClick={d.addChapter} className="btn-ghost text-xs">
            <Plus className="h-3.5 w-3.5" /> 添加章节
          </button>
          <button onClick={d.handleSaveOutline} disabled={d.savingOutline} className="btn-secondary text-xs">
            <Save className="h-3.5 w-3.5" /> {d.savingOutline ? '保存中…' : '保存大纲'}
          </button>
          <button onClick={d.handleConfirmOutline} className="btn-primary text-xs">
            <Check className="h-3.5 w-3.5" /> {d.confirmedAt ? '重新确认' : '确认大纲'}
          </button>
        </div>
      </div>
      {d.confirmedAt && (
        <div className="mb-2 rounded-md bg-green-50 px-3 py-2 text-xs text-green-600">
          大纲已确认，可开始「分章节生成」或「全文生成」
        </div>
      )}
      {d.outline.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center">
          <FileText className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm text-slate-400">还没有大纲，点击"添加章节"开始</p>
        </div>
      )}
      <div className="space-y-3">
        {d.outline.map((ch, ci) => (
          <div key={ci} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={ch.chapter || ch.title || ''}
                onChange={(e) => d.updateChapter(ci, e.target.value)}
                className="input flex-1 font-medium"
                placeholder="章节标题"
              />
              <button onClick={() => d.removeChapter(ci)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500">
                <Trash className="h-4 w-4" />
              </button>
            </div>
            {(ch.sections || []).map((sec, si) => (
              <div key={si} className="mt-2 flex items-start gap-2 pl-4">
                <span className="mt-2 text-slate-300">└</span>
                <input
                  type="text"
                  value={sec.title || ''}
                  onChange={(e) => d.updateSection(ci, si, 'title', e.target.value)}
                  className="input flex-1 text-sm"
                  placeholder="小节标题"
                />
                <input
                  type="text"
                  value={sec.content || ''}
                  onChange={(e) => d.updateSection(ci, si, 'content', e.target.value)}
                  className="input flex-1 text-sm"
                  placeholder="简述（可选）"
                />
                <button onClick={() => d.removeSection(ci, si)} className="mt-1 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button onClick={() => d.addSection(ci)} className="mt-2 ml-4 text-xs text-accent hover:underline">
              + 添加小节
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// 章节内容 tab：按已确认大纲逐章生成、编辑、局部重写与合并导出 Word
import FeaturePay from '../../FeaturePay.jsx';
import { Refresh, FileWord, FileText, Save } from '../../Icons.jsx';

export default function ChaptersTab({ d }) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">按已确认大纲逐章生成论文，可局部重写或编辑后继续</p>
        <div className="flex gap-2">
          <button onClick={d.loadChapters} className="btn-ghost text-xs">
            <Refresh className="h-3.5 w-3.5" /> 刷新
          </button>
          <button
            onClick={() => { if (!d.integrity.ensure(() => d.doGenerate())) return; d.doGenerate(); }}
            disabled={d.generating}
            className="btn-primary text-xs"
          >
            <Refresh className={`h-3.5 w-3.5 ${d.generating ? 'animate-spin' : ''}`} />
            {d.generating ? '生成中…' : '生成全部章节'}
          </button>
          {d.chapters.length > 0 && (
            <div className="flex items-center gap-2">
              <select
                className="input !w-auto !py-1.5 text-xs"
                value={d.mergeTemplateId}
                onChange={(e) => d.setMergeTemplateId(e.target.value)}
                title="合并导出应用的格式模板"
              >
                <option value="">默认学术格式</option>
                {d.templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <button onClick={d.doMerge} disabled={d.merging} className="btn-secondary text-xs">
                <FileWord className="h-3.5 w-3.5" /> {d.merging ? '导出中…' : '合并导出 Word'}
              </button>
            </div>
          )}
        </div>
      </div>
      {d.chapters.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center">
          <FileText className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm text-slate-400">确认大纲后，点击「生成全部章节」开始</p>
        </div>
      )}
      <div className="space-y-3">
        {d.chapters.map((ch) => (
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
                <button onClick={() => { if (!d.integrity.ensure(() => d.doRegenerate(ch.id))) return; d.doRegenerate(ch.id); }} className="ml-auto text-xs text-accent hover:underline">重新生成</button>
              )}
            </div>
            <textarea
              className="input mt-2 min-h-[120px] resize-y text-sm"
              value={ch.content || ''}
              onChange={(e) => d.setChapters((prev) => prev.map((c) => c.id === ch.id ? { ...c, content: e.target.value } : c))}
              placeholder="本章内容…"
            />
            <div className="mt-2 flex justify-end">
              <button onClick={() => d.saveChapter(ch.id, ch.content)} className="btn-ghost text-xs">
                <Save className="h-3.5 w-3.5" /> 保存
              </button>
            </div>
          </div>
        ))}
      </div>
      {d.needPay && (
        <FeaturePay
          needOrder={d.needPay}
          onPaid={(orderNo) => { d.setNeedPay(null); d.doGenerate(orderNo); }}
          onClose={() => d.setNeedPay(null)}
        />
      )}
    </div>
  );
}

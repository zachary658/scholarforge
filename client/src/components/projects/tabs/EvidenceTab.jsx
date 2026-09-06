// 文献与图表 tab：可溯源证据质量、证据检索、项目文献与图表入口
import { Refresh, Book } from '../../Icons.jsx';
import { fmtDate } from '../../../lib/projectUtils.js';

export default function EvidenceTab({ project, d }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">本论文的可溯源文献与数据图表</p>
        <div className="flex gap-2">
          <button onClick={() => d.navigate(`/app/references?projectId=${project.id}`)} className="btn-secondary text-xs">
            <Book className="h-3.5 w-3.5" /> 检索文献
          </button>
          <button onClick={() => d.navigate(`/app/charts?projectId=${project.id}`)} className="btn-secondary text-xs">
            新建图表
          </button>
        </div>
      </div>
      <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-ink">证据质量</h4>
            <p className="mt-1 text-xs text-slate-500">
              {d.evidenceQuality
                ? `${d.evidenceQuality.score} 分 · ${d.evidenceQuality.sources} 个来源 · ${d.evidenceQuality.chunks} 个片段 · 可溯源率 ${Math.round(d.evidenceQuality.traceability * 100)}%`
                : '尚未建立证据索引'}
            </p>
          </div>
          <button disabled={d.evidenceBusy} onClick={d.rebuildEvidence} className="btn-secondary text-xs">
            <Refresh className={`h-3.5 w-3.5 ${d.evidenceBusy ? 'animate-spin' : ''}`} /> 重建索引
          </button>
        </div>
        {d.evidenceQuality?.issues?.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-amber-700">
            {d.evidenceQuality.issues.map((issue) => <li key={issue}>• {issue}</li>)}
          </ul>
        )}
        <div className="mt-4 flex gap-2">
          <input
            value={d.evidenceQuery}
            onChange={(e) => d.setEvidenceQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && d.searchEvidence()}
            className="input flex-1"
            placeholder="输入章节主题，检查有哪些证据可用"
          />
          <button disabled={d.evidenceBusy} onClick={d.searchEvidence} className="btn-primary text-xs">检索证据</button>
        </div>
        {d.evidenceResults.length > 0 && (
          <div className="mt-3 space-y-2">
            {d.evidenceResults.map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-ink">{item.source_title || '未命名来源'}</span>
                  <span className="text-slate-400">{item.page_number ? `第 ${item.page_number} 页 · ` : ''}片段 {Number(item.chunk_index) + 1}</span>
                </div>
                <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-slate-600">{item.content}</p>
              </div>
            ))}
          </div>
        )}
      </section>
      <section>
        <h4 className="mb-2 text-sm font-semibold text-ink">项目文献 ({d.references.length})</h4>
        {d.references.length === 0 ? <p className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">尚未收藏项目文献</p> : (
          <div className="space-y-2">{d.references.map((ref) => (
            <div key={ref.id} className="rounded-lg border border-slate-100 px-4 py-3">
              <div className="text-sm font-medium text-ink">{ref.title}</div>
              <div className="mt-1 text-xs text-slate-400">{ref.authors} · {ref.year || '年份未知'} · {ref.source_db || ref.source}</div>
            </div>
          ))}</div>
        )}
      </section>
      <section>
        <h4 className="mb-2 text-sm font-semibold text-ink">项目图表 ({d.charts.length})</h4>
        {d.charts.length === 0 ? <p className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">尚未生成项目图表</p> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{d.charts.map((chart) => (
            <button key={chart.id} onClick={() => d.navigate(`/app/charts?projectId=${project.id}`)} className="rounded-lg border border-slate-100 p-3 text-left hover:border-accent/30">
              <div className="truncate text-sm font-medium text-ink">{chart.title}</div>
              <div className="mt-1 text-xs text-slate-400">{chart.chart_type} · {fmtDate(chart.created_at)}</div>
            </button>
          ))}</div>
        )}
      </section>
    </div>
  );
}

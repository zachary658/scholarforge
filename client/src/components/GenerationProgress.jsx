import { FileWord, Download, Refresh } from './Icons.jsx';

// 生成结果面板：统一承载「结果头部（下载/重新生成） + 计费条 + 正文/Word/空态」。
// 与 useTool 解耦，仅接收已计算好的展示数据与回调，供 DocumentGenerator 组装。
export default function GenerationProgress({
  loading, result, docInfo, content,
  title, onDownload, onRegenerate,
  emptyTitle, emptyDesc, docEmptyTitle, docEmptyDesc,
}) {
  return (
    <div className="card flex flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <span className="text-sm font-medium text-slate-600">{title}</span>
        {result && (
          <div className="flex items-center gap-1">
            {docInfo && (
              <button onClick={onDownload} className="btn-ghost text-xs text-accent">
                <Download className="h-4 w-4" /> 下载 Word
              </button>
            )}
            <button onClick={onRegenerate} disabled={loading} className="btn-ghost text-xs">
              <Refresh className="h-4 w-4" /> 重新生成
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {result ? (
          <div>
            {result.chargeType && (
              <div className="mb-3 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                {result.chargeType === 'paid' ? (
                  <span className="rounded bg-accent-50 px-1.5 py-0.5 font-medium text-accent">
                    已付费 ¥{Number(result.amount || 0).toFixed(2)}
                  </span>
                ) : null}
                {docInfo && (
                  <span className="ml-auto flex items-center gap-1 text-slate-400">
                    <FileWord className="h-3.5 w-3.5" /> Word 已生成
                  </span>
                )}
              </div>
            )}

            {content ? (
              <pre className="whitespace-pre-wrap font-serif text-[13px] leading-[1.8] text-slate-700">{content}</pre>
            ) : docInfo ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-50 text-accent">
                  <FileWord className="h-7 w-7" />
                </div>
                <p className="mt-4 text-sm font-medium text-ink">{docEmptyTitle}</p>
                <p className="mt-1 text-xs text-slate-400">{docEmptyDesc}</p>
                <button onClick={onDownload} className="btn-primary mt-4">
                  <Download className="h-4 w-4" /> 立即下载
                </button>
              </div>
            ) : (
              <p className="text-sm text-slate-400">内容已生成</p>
            )}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-50 text-accent">
              <FileWord className="h-7 w-7" />
            </div>
            <p className="mt-4 text-sm font-medium text-slate-600">{emptyTitle}</p>
            <p className="mt-1 text-xs text-slate-400">{emptyDesc}</p>
          </div>
        )}
      </div>
    </div>
  );
}

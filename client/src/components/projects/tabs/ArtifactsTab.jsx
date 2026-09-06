// 成果文件 tab：本论文生成的 Word、PPT 与合并交付文件
import { useToast } from '../../Toast.jsx';
import { Refresh, FileWord } from '../../Icons.jsx';
import { fmtDate } from '../../../lib/projectUtils.js';

export default function ArtifactsTab({ d }) {
  const toast = useToast();
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-slate-500">本论文生成的 Word、PPT 与合并交付文件</p>
        <button onClick={d.loadArtifacts} className="btn-ghost px-3 py-1.5 text-xs">
          <Refresh className="h-3.5 w-3.5" /> 刷新
        </button>
      </div>
      {d.artifacts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
          暂无项目成果。后续生成的 Word、PPT 和合并文档会自动归档到这里
        </div>
      ) : (
        <div className="space-y-2">
          {d.artifacts.map((doc) => (
            <div key={doc.id} className="flex items-center gap-3 rounded-lg border border-slate-100 px-4 py-3">
              <FileWord className="h-5 w-5 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">{doc.title}</div>
                <div className="mt-0.5 text-xs text-slate-400">{doc.feature} · {fmtDate(doc.created_at)}</div>
              </div>
              <button
                onClick={async () => {
                  try {
                    const { downloadDocFile } = await import('../../../lib/api.js');
                    await downloadDocFile(doc.id, doc.title);
                  } catch (err) {
                    toast.error('下载失败：' + err.message);
                  }
                }}
                className="btn-secondary shrink-0 px-3 py-1.5 text-xs"
              >
                下载
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

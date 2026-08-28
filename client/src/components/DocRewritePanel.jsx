import { useRef, useState } from 'react';
import { api, downloadDocFile } from '../lib/api.js';
import FeaturePay from './FeaturePay.jsx';
import AcademicIntegrityModal from './AcademicIntegrityModal.jsx';
import { useAcademicIntegrity } from '../lib/useAcademicIntegrity.js';
import { Refresh, FileText, Download, Check, FileWord, BadgeCheck } from './Icons.jsx';
import { toast } from './Toast.jsx';

// 整篇文档改写面板（降重 / 降AI率共用）
// mode: 'rewrite' | 'ai_reduce'
// 上传 .docx → 后端仅改写正文段落（保留格式/标题/图表/图片/公式/表格）→ 下载处理后的文档
export default function DocRewritePanel({ mode }) {
  const integrity = useAcademicIntegrity();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [needOrder, setNeedOrder] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const isRewrite = mode === 'rewrite';
  const label = isRewrite ? '降重' : '降AI率';

  const pickFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.docx')) {
      toast.error('仅支持 .docx 文档');
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error('文档不能超过 10MB');
      return;
    }
    setFile(f);
    setResult(null);
    setError('');
  };

  const process = async (orderNo) => {
    if (!file) return;
    // 学术诚信承诺书门禁（与后端一致）
    if (!integrity.ensure(() => process(orderNo))) return;
    setProcessing(true);
    setError('');
    setResult(null);
    setNeedOrder(null);
    try {
      const apiFn = isRewrite ? api.rewriteDoc : api.aiReduceDoc;
      const data = await apiFn(file, orderNo);
      if (data.needOrder) {
        setNeedOrder({ itemType: data.itemType, amount: data.amount, materialIds: [], materialFee: 0 });
      } else if (data.ok && data.doc) {
        setResult(data);
        toast.success(`${label}完成：改写 ${data.stats.rewrittenParas} 段，保留格式与图表`);
      } else {
        setError(data.error || '处理失败');
      }
    } catch (err) {
      setError(err.message || '处理失败');
    } finally {
      setProcessing(false);
    }
  };

  // 下载走鉴权接口（download_url 直链不带 Authorization 会 401）
  const handleDownload = async () => {
    if (!result?.doc) return;
    try {
      await downloadDocFile(result.doc.id, `${label}_${file?.name || '文档.docx'}`);
    } catch (err) {
      toast.error(err.message || '下载失败');
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center">
        <input ref={fileRef} type="file" accept=".docx" className="hidden" onChange={pickFile} />
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-50 text-accent mx-auto">
          <FileText className="h-6 w-6" />
        </div>
        <p className="mt-3 text-sm font-medium text-ink">上传整篇论文文档（.docx）</p>
        <p className="mt-1 text-xs text-slate-500">
          仅改写正文段落——<strong>标题、图表、图片、公式、表格全部原样保留</strong>，格式不变；处理后下载新文档
        </p>
        <div className="mt-4 flex items-center justify-center gap-3">
          <button onClick={() => fileRef.current?.click()} disabled={processing} className="btn-ghost border border-slate-300 px-4 py-2 text-sm">
            <FileWord className="h-4 w-4" /> {file ? file.name : '选择文档'}
          </button>
          <button onClick={() => process()} disabled={!file || processing} className="btn-primary px-5 py-2 text-sm">
            {processing ? <><Refresh className="h-4 w-4 animate-spin" /> 处理中（分批改写，约 1-3 分钟）…</> : <><Check className="h-4 w-4" /> 开始{label}</>}
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-400">本功能为付费功能（按次计费），处理后文档保存 30 天，请及时下载</p>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      {result?.doc && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4">
          <div className="flex items-center gap-3">
            <BadgeCheck className="h-5 w-5 text-emerald-500" />
            <div>
              <div className="text-sm font-medium text-emerald-700">{label}处理完成</div>
              <div className="mt-0.5 text-xs text-emerald-600">
                改写 {result.stats?.rewrittenParas} 段正文 · 保留 {result.stats?.keptCharts} 个段落（标题/图表/表格等原样保留）
              </div>
            </div>
          </div>
          <button onClick={handleDownload} className="btn-primary px-4 py-2 text-sm">
            <Download className="h-4 w-4" /> 下载文档
          </button>
        </div>
      )}

      {needOrder && (
        <FeaturePay needOrder={needOrder} onPaid={(orderNo) => process(orderNo)} onClose={() => setNeedOrder(null)} />
      )}

      {integrity.show && (
        <AcademicIntegrityModal onAgreed={integrity.handleAgreed} onCancel={integrity.close} />
      )}
    </div>
  );
}

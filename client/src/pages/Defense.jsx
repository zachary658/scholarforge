import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, downloadDocFile } from '../lib/api.js';
import { useTool } from '../lib/useTool.js';
import FeaturePay from '../components/FeaturePay.jsx';
import {
  FileWord, Download, Refresh, Layers, Sparkle, ChevronDown,
} from '../components/Icons.jsx';

const fields = ['计算机科学', '经济学', '管理学', '教育学', '医学', '法学', '文学', '心理学', '社会学', '工程学', '其他'];

export default function Defense() {
  const navigate = useNavigate();
  const tool = useTool();

  const [form, setForm] = useState({
    topic: '',
    field: '计算机科学',
    summary: '',
    innovation: '',
    duration: '10',
    template_id: '',
  });
  const [templates, setTemplates] = useState([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    api.listTemplates().then((d) => setTemplates(d.templates || [])).catch(() => {});
  }, []);

  const result = tool.result;
  const docInfo = result?.doc || null;
  const content = result?.content || '';

  const run = (orderNo) => {
    if (!form.topic.trim()) {
      tool.setError('请填写论文题目');
      return;
    }
    tool.run(() => api.defense({ ...form, template_id: form.template_id || undefined, orderNo: orderNo || undefined }));
  };

  const handleDownload = () => {
    if (docInfo?.id) {
      downloadDocFile(docInfo.id, `${form.topic || '论文'}答辩材料`);
    }
  };

  const update = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col px-8 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">答辩PPT与演讲稿</h1>
          <p className="mt-1 text-sm text-slate-500">生成答辩PPT大纲与配套演讲稿，10-15分钟答辩全覆盖</p>
        </div>
      </div>

      <div className="grid flex-1 gap-6 lg:grid-cols-[380px_1fr]">
        {/* 设置面板 */}
        <div className="card flex flex-col p-6">
          <div className="space-y-4">
            <div>
              <label className="label">论文题目 *</label>
              <textarea
                className="input min-h-[60px] resize-none"
                placeholder="例如：基于深度学习的医学影像分割方法研究"
                value={form.topic}
                onChange={(e) => update('topic', e.target.value)}
              />
            </div>
            <div>
              <label className="label">学科领域 *</label>
              <select className="input" value={form.field} onChange={(e) => update('field', e.target.value)}>
                {fields.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">研究内容摘要</label>
              <textarea
                className="input min-h-[60px] resize-none"
                placeholder="简要描述研究的主要内容与结论"
                value={form.summary}
                onChange={(e) => update('summary', e.target.value)}
              />
            </div>

            {/* 高级选项 */}
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex w-full items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              <span>更多选项（可选）</span>
              <ChevronDown className={`h-4 w-4 transition ${showAdvanced ? 'rotate-180' : ''}`} />
            </button>
            {showAdvanced && (
              <div className="space-y-4 border-l-2 border-accent-100 pl-3">
                <div>
                  <label className="label">创新点</label>
                  <input
                    className="input"
                    placeholder="研究的创新之处"
                    value={form.innovation}
                    onChange={(e) => update('innovation', e.target.value)}
                  />
                </div>
              </div>
            )}

            <div>
              <label className="label">答辩时长</label>
              <select className="input" value={form.duration} onChange={(e) => update('duration', e.target.value)}>
                <option value="10">10 分钟</option>
                <option value="15">15 分钟</option>
                <option value="20">20 分钟</option>
              </select>
            </div>

            <div>
              <label className="label">
                <span className="flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-slate-400" />格式模板（可选）
                </span>
              </label>
              <select
                className="input"
                value={form.template_id}
                onChange={(e) => update('template_id', e.target.value)}
              >
                <option value="">使用默认学术格式</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}{t.is_global ? '（全局）' : t.is_mine ? '（我的）' : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-slate-400">
                上传 .docx 模板可按你的格式生成，{''}
                <button onClick={() => navigate('/app/templates')} className="text-accent hover:underline">去上传</button>
              </p>
            </div>
          </div>

          <div className="mt-5 flex-1" />
          <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            本功能为付费功能，先下单支付后再生成
          </div>
          <button onClick={() => run()} disabled={tool.loading} className="btn-primary w-full py-3">
            {tool.loading ? (
              <><Refresh className="h-4 w-4 animate-spin" /> 生成中…</>
            ) : (
              <><Sparkle className="h-4 w-4" /> 生成答辩材料</>
            )}
          </button>
          {tool.error && (
            <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{tool.error}</div>
          )}
        </div>

        {/* 结果面板 */}
        <div className="card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <span className="text-sm font-medium text-slate-600">
              {form.topic ? `${form.topic} · 答辩材料` : '生成结果'}
            </span>
            {result && (
              <div className="flex items-center gap-1">
                {docInfo && (
                  <button onClick={handleDownload} className="btn-ghost text-xs text-accent">
                    <Download className="h-4 w-4" /> 下载 Word
                  </button>
                )}
                <button onClick={() => run()} disabled={tool.loading} className="btn-ghost text-xs">
                  <Refresh className="h-4 w-4" /> 重新生成
                </button>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {result ? (
              <div>
                {/* 计费信息条 */}
                {result.chargeType && (
                  <div className="mb-3 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    {result.chargeType === 'paid' ? (
                      <span className="rounded bg-accent-50 px-1.5 py-0.5 font-medium text-accent">已付费 ¥{Number(result.amount || 0).toFixed(2)}</span>
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
                    <p className="mt-4 text-sm font-medium text-ink">答辩材料已生成 Word 文档</p>
                    <p className="mt-1 text-xs text-slate-400">点击右上角「下载 Word」获取完整答辩材料</p>
                    <button onClick={handleDownload} className="btn-primary mt-4">
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
                <p className="mt-4 text-sm font-medium text-slate-600">填写论文信息后生成答辩材料</p>
                <p className="mt-1 text-xs text-slate-400">答辩PPT大纲与演讲稿，一键导出 Word</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {tool.needOrder && (
        <FeaturePay needOrder={tool.needOrder} onPaid={(orderNo) => run(orderNo)} onClose={() => tool.cancelOrder()} />
      )}
    </div>
  );
}

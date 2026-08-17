import { useEffect, useState } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { api, downloadDocFile } from '../lib/api.js';
import { useTool } from '../lib/useTool.js';
import { FIELDS } from '../lib/constants.js';
import RechargeBanner from '../components/RechargeBanner.jsx';
import {
  FileWord, Download, Refresh, Layers, Crown, Gift, Sparkle, ChevronDown,
} from '../components/Icons.jsx';

export default function Proposal() {
  const { refreshStatus, status } = useOutletContext();
  const navigate = useNavigate();
  const tool = useTool(refreshStatus);

  const [form, setForm] = useState({
    topic: '',
    field: '计算机科学',
    direction: '',
    keywords: '',
    objective: '',
    method: '',
    innovation: '',
    template_id: '',
  });
  const [templates, setTemplates] = useState([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    api.listTemplates().then((d) => setTemplates(d.templates || [])).catch(() => {});
  }, []);

  const total = status?.total ?? 0;
  const balance = status?.balance ?? 0;
  const signup = status?.signup ?? 0;
  const result = tool.result;
  const docInfo = result?.doc || null;
  const content = result?.content || '';

  const run = () => {
    if (!form.topic.trim()) {
      tool.setError('请填写论文题目');
      return;
    }
    tool.run(() => api.proposal({ ...form, template_id: form.template_id || undefined }));
  };

  const handleDownload = () => {
    if (docInfo?.id) {
      downloadDocFile(docInfo.id, `${form.topic || '研究'}开题报告`);
    }
  };

  const update = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col px-8 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">开题报告撰写</h1>
          <p className="mt-1 text-sm text-slate-500">填写研究要素，生成结构完整的开题报告并导出 Word</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="flex items-center gap-1"><Gift className="h-3.5 w-3.5 text-accent" />可用 {total}</span>
          <span className="text-slate-300">|</span>
          <span className="flex items-center gap-1"><Crown className="h-3 w-3 text-amber-500" />积分 {balance}</span>
          <span className="text-slate-300">|</span>
          <span>赠送 {signup}</span>
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
                {FIELDS.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">研究方向</label>
              <input
                className="input"
                placeholder="例如：计算机视觉 / 自然语言处理"
                value={form.direction}
                onChange={(e) => update('direction', e.target.value)}
              />
            </div>
            <div>
              <label className="label">关键词</label>
              <input
                className="input"
                placeholder="多个关键词用逗号分隔"
                value={form.keywords}
                onChange={(e) => update('keywords', e.target.value)}
              />
            </div>

            {/* 高级选项 */}
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex w-full items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              <span>更多研究要素（可选）</span>
              <ChevronDown className={`h-4 w-4 transition ${showAdvanced ? 'rotate-180' : ''}`} />
            </button>
            {showAdvanced && (
              <div className="space-y-4 border-l-2 border-accent-100 pl-3">
                <div>
                  <label className="label">研究目标</label>
                  <textarea
                    className="input min-h-[56px] resize-none"
                    placeholder="描述研究想要达成的目标"
                    value={form.objective}
                    onChange={(e) => update('objective', e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">研究方法</label>
                  <input
                    className="input"
                    placeholder="例如：问卷调查、实验法、案例研究"
                    value={form.method}
                    onChange={(e) => update('method', e.target.value)}
                  />
                </div>
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
            {total > 0 ? `本次将消耗 1 次额度，剩余 ${total} 次` : '当前无额度，本次按功能价格付费'}
          </div>
          <button onClick={run} disabled={tool.loading} className="btn-primary w-full py-3">
            {tool.loading ? (
              <><Refresh className="h-4 w-4 animate-spin" /> 生成中…</>
            ) : (
              <><Sparkle className="h-4 w-4" /> 生成开题报告</>
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
              {form.topic ? `${form.topic} · 开题报告` : '生成结果'}
            </span>
            {result && (
              <div className="flex items-center gap-1">
                {docInfo && (
                  <button onClick={handleDownload} className="btn-ghost text-xs text-accent">
                    <Download className="h-4 w-4" /> 下载 Word
                  </button>
                )}
                <button onClick={run} disabled={tool.loading} className="btn-ghost text-xs">
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
                    ) : result.chargeType === 'points' ? (
                      <><Crown className="h-3.5 w-3.5 text-amber-500" /><span>已消耗积分</span></>
                    ) : result.chargeType === 'free_signup' ? (
                      <><Gift className="h-3.5 w-3.5 text-accent" /><span>已消耗 1 次赠送额度</span></>
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
                    <p className="mt-4 text-sm font-medium text-ink">开题报告已生成 Word 文档</p>
                    <p className="mt-1 text-xs text-slate-400">点击右上角「下载 Word」获取完整报告</p>
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
                <p className="mt-4 text-sm font-medium text-slate-600">填写研究要素后生成开题报告</p>
                <p className="mt-1 text-xs text-slate-400">报告含 10 个标准章节，一键导出 Word</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {tool.needRecharge && (
        <RechargeBanner balance={tool.needRecharge.balance} needed={tool.needRecharge.needed} />
      )}
    </div>
  );
}

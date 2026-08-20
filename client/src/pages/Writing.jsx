import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, downloadDocFile } from '../lib/api.js';
import { useTool } from '../lib/useTool.js';
import { FIELDS } from '../lib/constants.js';
import FeaturePay from '../components/FeaturePay.jsx';
import AcademicIntegrityModal from '../components/AcademicIntegrityModal.jsx';
import { useAcademicIntegrity } from '../lib/useAcademicIntegrity.js';
import {
  Sparkle, Copy, Download, Refresh, Check, FileWord, Layers, BadgeCheck,
} from '../components/Icons.jsx';
import { toast } from '../components/Toast.jsx';

// 借鉴千笔写作：大纲生成免费且不限次（引流策略）
const writeTypes = [
  { value: 'outline', label: '大纲生成', free: true, desc: '免费不限次' },
  { value: 'paragraph', label: '段落续写' },
  { value: 'abstract', label: '摘要生成' },
  { value: 'fulltext', label: '全文生成' },
];

export default function Writing() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tool = useTool();
  const integrity = useAcademicIntegrity(); // 全文生成前强制签署学术诚信承诺书

  const [form, setForm] = useState({ type: 'outline', topic: '', field: '计算机科学', template_id: '' });
  const [templates, setTemplates] = useState([]);
  const [copied, setCopied] = useState(false);
  const [projectId, setProjectId] = useState(null);
  const copyTimerRef = useRef(null);

  useEffect(() => {
    api.listTemplates().then((d) => setTemplates(d.templates || [])).catch(() => {});
  }, []);

  // 从工作区「全流程」跳转进来时，读取 projectId 与 type，预选写作类型并关联工作区上下文
  useEffect(() => {
    const pid = searchParams.get('projectId');
    const tp = searchParams.get('type');
    if (pid) setProjectId(pid);
    if (tp && writeTypes.some((t) => t.value === tp)) {
      setForm((f) => ({ ...f, type: tp }));
    }
  }, [searchParams]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const result = tool.result;
  const docInfo = result?.doc || null;
  // 写作类内容在真实支付通道下 result.content 可能为 null（只存 Word），靠 doc 下载
  const content = result?.content || '';

  const run = (orderNo) => {
    if (!form.topic.trim()) {
      tool.setError('请填写论文题目');
      return;
    }
    // 全文生成强制承诺书门禁（与后端 403 needAcademicIntegrity 校验一致）：
    // 未同意时弹出承诺书，同意后自动重新执行本次生成
    if (form.type === 'fulltext' && !integrity.ensure(() => run(orderNo))) {
      return;
    }
    tool.run(() => api.writing({
      ...form,
      template_id: form.template_id || undefined,
      projectId: projectId || undefined,
      orderNo: orderNo || undefined,
    }));
  };

  const handleCopy = async () => {
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(content);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('复制失败，请手动复制');
    }
  };

  const handleDownload = () => {
    if (docInfo?.id) {
      downloadDocFile(docInfo.id, form.topic || '论文');
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col px-8 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">AI 论文写作</h1>
          <p className="mt-1 text-sm text-slate-500">选择写作类型，输入题目与学科领域，一键生成学术内容并导出 Word</p>
        </div>
      </div>

      <div className="grid flex-1 gap-6 lg:grid-cols-[340px_1fr]">
        {/* 设置面板 */}
        <div className="card flex flex-col p-6">
          <div className="space-y-4">
            <div>
              <label className="label">写作类型</label>
              <div className="grid grid-cols-2 gap-2">
                {writeTypes.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setForm({ ...form, type: t.value })}
                    className={`relative rounded-lg border px-3 py-2.5 text-sm font-medium transition ${
                      form.type === t.value
                        ? 'border-accent bg-accent-50 text-accent'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {t.label}
                    {t.free && (
                      <span className="absolute -right-1 -top-1.5 inline-flex items-center gap-0.5 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-sm">
                        <BadgeCheck className="h-2.5 w-2.5" />免费
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {form.type === 'outline' && (
                <p className="mt-1.5 text-xs text-emerald-600">
                  大纲生成免费且不限次，3 级结构化大纲，不消耗任何额度
                </p>
              )}
            </div>
            <div>
              <label className="label">学科领域</label>
              <select className="input" value={form.field} onChange={(e) => setForm({ ...form, field: e.target.value })}>
                {FIELDS.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">论文题目</label>
              <textarea
                className="input min-h-[80px] resize-none"
                placeholder="例如：深度学习在医学影像分割中的应用"
                value={form.topic}
                onChange={(e) => setForm({ ...form, topic: e.target.value })}
              />
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
                onChange={(e) => setForm({ ...form, template_id: e.target.value })}
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
            {form.type === 'outline' ? (
              <span className="flex items-center gap-1 text-emerald-600">
                <BadgeCheck className="h-3.5 w-3.5" /> 大纲生成免费且不限次
              </span>
            ) : (
              '本功能为付费功能，先下单支付后再生成'
            )}
          </div>
          <button onClick={() => run()} disabled={tool.loading} className="btn-primary w-full py-3">
            {tool.loading ? (
              <><Refresh className="h-4 w-4 animate-spin" /> 生成中…</>
            ) : (
              <><Sparkle className="h-4 w-4" /> 生成内容</>
            )}
          </button>
          {tool.error && (
            <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{tool.error}</div>
          )}
          {/* 全文生成需要已确认大纲的工作区：给出直达引导 */}
          {tool.errorData?.needConfirmOutline && (
            <button
              onClick={() => navigate('/app/projects')}
              className="mt-2 w-full rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-600 hover:bg-amber-100"
            >
              去论文工作区创建项目并确认大纲 →
            </button>
          )}
        </div>

        {/* 结果面板 */}
        <div className="card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <span className="text-sm font-medium text-slate-600">
              {form.topic ? form.topic : '生成结果'}
            </span>
            {result && (
              <div className="flex items-center gap-1">
                {content && (
                  <button onClick={handleCopy} className="btn-ghost text-xs">
                    {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    {copied ? '已复制' : '复制'}
                  </button>
                )}
                {docInfo && (
                  <button onClick={handleDownload} className="btn-ghost text-xs text-accent">
                    <Download className="h-4 w-4" /> 下载 Word
                  </button>
                )}
                <button onClick={() => run()} disabled={tool.loading} className="btn-ghost text-xs">
                  <Refresh className="h-4 w-4" /> 重写
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
                      <><span className="rounded bg-accent-50 px-1.5 py-0.5 font-medium text-accent">已付费 ¥{Number(result.amount || 0).toFixed(2)}</span></>
                    ) : result.chargeType === 'unlimited' ? (
                      <><BadgeCheck className="h-3.5 w-3.5 text-emerald-500" /><span className="text-emerald-600">免费功能·不消耗额度</span></>
                    ) : null}
                    {docInfo && (
                      <span className="ml-auto flex items-center gap-1 text-slate-400">
                        <FileWord className="h-3.5 w-3.5" /> Word 已生成
                      </span>
                    )}
                  </div>
                )}
                {content ? (
                  <pre className="whitespace-pre-wrap font-serif text-[14px] leading-[1.85] text-slate-700">{content}</pre>
                ) : docInfo ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-50 text-accent">
                      <FileWord className="h-7 w-7" />
                    </div>
                    <p className="mt-4 text-sm font-medium text-ink">内容已生成 Word 文档</p>
                    <p className="mt-1 text-xs text-slate-400">点击右上角「下载 Word」获取完整内容</p>
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
                  <Sparkle className="h-7 w-7" />
                </div>
                <p className="mt-4 text-sm font-medium text-slate-600">填写左侧信息后点击「生成内容」</p>
                <p className="mt-1 text-xs text-slate-400">生成的内容将以 Word 格式保存，可随时下载</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {tool.needOrder && (
        <FeaturePay needOrder={tool.needOrder} onPaid={(orderNo) => run(orderNo)} />
      )}

      {integrity.show && (
        <AcademicIntegrityModal onAgreed={integrity.handleAgreed} onCancel={integrity.close} />
      )}
    </div>
  );
}

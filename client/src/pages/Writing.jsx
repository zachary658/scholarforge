import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, downloadDocFile } from '../lib/api.js';
import { useTool } from '../lib/useTool.js';
import { FIELDS } from '../lib/constants.js';
import { copyText } from '../lib/utils.js';
import FeaturePay from '../components/FeaturePay.jsx';
import AcademicIntegrityModal from '../components/AcademicIntegrityModal.jsx';
import SmartWritingResult from '../components/SmartWritingResult.jsx';
import ReviewChainPanel from '../components/ReviewChainPanel.jsx';
import { useAcademicIntegrity } from '../lib/useAcademicIntegrity.js';
import {
  Sparkle, Copy, Download, Refresh, Check, FileWord, Layers, BadgeCheck, Brain, Book,
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
  const [linkedProject, setLinkedProject] = useState(null);
  const copyTimerRef = useRef(null);
  // 深度文献调研（大纲生成后的付费升级）：多角度检索 → 解析研究框架/文献/数据
  const [distill, setDistill] = useState({ loading: false, error: '', result: null, needOrder: null });
  // 深度调研请求序号：换题/重新发起后使在途旧请求的响应过期，防止旧结果错挂到新题（竞态防护）
  const distillSeqRef = useRef(0);
  // 参考材料：上传解读（docx/pdf/txt）→ 勾选参与生成（材料解读 token 计入订单费用）
  const [materials, setMaterials] = useState([]);
  const [selectedMaterials, setSelectedMaterials] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    api.listTemplates().then((d) => setTemplates(d.templates || [])).catch(() => {});
    loadMaterials();
  }, []);

  const loadMaterials = () => {
    api.listMaterials(projectId ? { projectId } : {}).then((d) => setMaterials(d.materials || [])).catch(() => {});
  };

  // 工作区切换后刷新材料列表
  useEffect(() => { loadMaterials(); }, [projectId]);

  const handleUploadMaterial = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const d = await api.uploadMaterial(file, projectId ? { projectId } : {});
      toast.success(`资料「${d.name}」已解读（${d.tokens} tokens），生成时将计入材料解读费`);
      loadMaterials();
      setSelectedMaterials((prev) => [...prev, d.id]);
    } catch (err) {
      toast.error(err.message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const toggleMaterial = (id) => {
    setSelectedMaterials((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleDeleteMaterial = async (id) => {
    try {
      await api.deleteMaterial(id);
      setSelectedMaterials((prev) => prev.filter((x) => x !== id));
      loadMaterials();
    } catch (err) {
      toast.error(err.message || '删除失败');
    }
  };

  // 换题后清空旧调研结果：防止旧题的蒸馏产物错位挂在新题大纲下，且「开始深度调研」按钮被旧结果挡住无法发起新调研
  useEffect(() => {
    distillSeqRef.current += 1; // 使在途旧请求的响应序号过期，落地后直接丢弃
    setDistill({ loading: false, error: '', result: null, needOrder: null });
  }, [form.topic]);

  // 从工作区「全流程」跳转进来时，读取 projectId 与 type，预选写作类型并关联工作区上下文
  useEffect(() => {
    const pid = searchParams.get('projectId');
    const tp = searchParams.get('type');
    setProjectId(pid || null);
    if (tp && writeTypes.some((t) => t.value === tp)) {
      setForm((f) => ({ ...f, type: tp }));
    }
    if (!pid) {
      setLinkedProject(null);
      return undefined;
    }
    let cancelled = false;
    api.getProject(pid).then(({ project }) => {
      if (cancelled || !project) return;
      setLinkedProject(project);
      setForm((f) => ({
        ...f,
        topic: project.title || f.topic,
        field: project.field || f.field,
      }));
    }).catch((err) => {
      if (!cancelled) tool.setError(`加载论文工作区失败：${err.message}`);
    });
    return () => { cancelled = true; };
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
      material_ids: selectedMaterials.length > 0 ? selectedMaterials : undefined,
    }));
  };

  const handleCopy = async () => {
    const ok = await copyText(content);
    if (!ok) return;
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
  };

  // 深度文献调研：大纲生成后的付费升级（需已支付的文献综述订单）
  // 请求序号防竞态：响应落地前发现序号已过期（期间已换题/重新发起）则丢弃，防止旧结果覆盖新状态
  const runDistill = async (orderNo) => {
    if (!form.topic.trim()) return;
    const seq = ++distillSeqRef.current;
    setDistill({ loading: true, error: '', result: null, needOrder: null });
    try {
      const data = await api.smartWriting({
        topic: form.topic.trim(),
        field: form.field,
        projectId: projectId || undefined,
        orderNo: orderNo || undefined,
      });
      if (seq !== distillSeqRef.current) return;
      if (data.needOrder) {
        setDistill({ loading: false, error: '', result: null, needOrder: { itemType: data.itemType, amount: data.amount } });
      } else {
        setDistill({ loading: false, error: '', result: data, needOrder: null });
        if (data.autoProject) {
          toast.success(
            `深度调研结果已自动保存到论文工作区「${data.autoProjectTitle || '我的论文工作区'}」；内容保留 ${data.retention_days || 30} 天，请及时下载 Word 保存`,
            7000
          );
        }
      }
    } catch (err) {
      if (seq !== distillSeqRef.current) return;
      setDistill({ loading: false, error: err.message || '深度调研失败', result: null, needOrder: null });
    }
  };

  const handleDownload = async () => {
    if (!docInfo?.id) return;
    try {
      await downloadDocFile(docInfo.id, form.topic || '论文');
    } catch (err) {
      toast.error(err.message || '下载失败');
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col px-8 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">AI 论文写作</h1>
          <p className="mt-1 text-sm text-slate-500">选择写作类型，输入题目与学科领域，一键生成学术内容并导出 Word</p>
          {linkedProject && (
            <p className="mt-2 text-xs font-medium text-blue-600">已关联论文工作区：{linkedProject.title}</p>
          )}
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
                    onClick={() => {
                      if (form.type === t.value) return;
                      tool.reset(); // 切换类型时清空旧结果，防止旧结果（含免费/已付费标识）误导
                      setForm({ ...form, type: t.value });
                    }}
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
            {/* 参考材料：完全可选——不上传资料也可直接生成；上传后生成将参考你的资料 */}
            <div>
              <label className="label">
                <span className="flex items-center gap-1.5">
                  <Book className="h-3.5 w-3.5 text-slate-400" />参考材料（选填）
                </span>
              </label>
              <p className="mb-2 text-xs text-slate-400">不上传资料也可以直接生成；上传后生成内容将参考你的资料</p>
              <input ref={fileRef} type="file" accept=".docx,.pdf,.txt,.md" className="hidden" onChange={handleUploadMaterial} />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="btn-ghost w-full border border-dashed border-slate-300 py-2 text-xs"
              >
                {uploading ? '解读中…' : '+ 上传资料（docx / pdf / txt，可选）'}
              </button>
              {materials.length > 0 && (
                <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                  {materials.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1.5">
                      <input type="checkbox" checked={selectedMaterials.includes(m.id)} onChange={() => toggleMaterial(m.id)} className="h-3.5 w-3.5 shrink-0 accent-accent" />
                      <span className="min-w-0 flex-1 truncate text-xs text-slate-600" title={m.name}>{m.name}</span>
                      <span className="shrink-0 text-[10px] text-slate-400">{m.tokens} tokens</span>
                      <button onClick={() => handleDeleteMaterial(m.id)} className="shrink-0 text-xs text-slate-400 hover:text-red-500">删</button>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-1.5 text-xs text-slate-400">
                勾选的资料才会作为生成参考（按 token 量计入费用）；不勾选则不产生额外费用
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
                {result.reviewChain && form.type === 'fulltext' && (
                  <ReviewChainPanel chain={result.reviewChain} report={result.review} />
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

                {/* ===== 大纲生成后的「深度文献调研」升级（单页面递进式） ===== */}
                {form.type === 'outline' && result && !distill.result && (
                  <div className="mt-5 rounded-xl border border-accent/25 bg-accent-50/40 p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent">
                        <Brain className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-ink">深度文献调研（付费升级）</div>
                        <p className="mt-1 text-xs leading-relaxed text-slate-500">
                          从多个研究角度深度检索真实文献，解析出研究方法、创新点和结论，附带真实文献清单与可参考的实验数据表格，
                          存入工作区供正文自动引用
                        </p>
                      </div>
                      <button onClick={() => runDistill()} disabled={distill.loading} className="btn-primary shrink-0 px-3 py-2 text-xs">
                        {distill.loading ? (
                          <><Refresh className="h-3.5 w-3.5 animate-spin" /> 深度调研中…（约 1 分钟）</>
                        ) : (
                          <><Brain className="h-3.5 w-3.5" /> 开始深度调研</>
                        )}
                      </button>
                    </div>
                    {distill.error && (
                      <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{distill.error}</div>
                    )}
                  </div>
                )}

                {form.type === 'outline' && distill.result && (
                  <div className="mt-5 rounded-xl border border-accent/30">
                    <SmartWritingResult result={distill.result} />
                  </div>
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
        <FeaturePay needOrder={tool.needOrder} onPaid={(orderNo) => run(orderNo)} onClose={() => tool.cancelOrder()} />
      )}

      {distill.needOrder && (
        <FeaturePay
          needOrder={distill.needOrder}
          onPaid={(orderNo) => runDistill(orderNo)}
          onClose={() => setDistill((d) => ({ ...d, needOrder: null }))}
        />
      )}

      {integrity.show && (
        <AcademicIntegrityModal onAgreed={integrity.handleAgreed} onCancel={integrity.close} />
      )}
    </div>
  );
}

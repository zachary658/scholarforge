import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { FIELDS } from '../lib/constants.js';
import FeaturePay from '../components/FeaturePay.jsx';
import {
  Sparkle, Copy, Refresh, Check, Brain, Book, Layers, Table, BadgeCheck, ArrowRight,
} from '../components/Icons.jsx';
import { toast } from '../components/Toast.jsx';

// 智能写作：多视角检索 → 蒸馏 → 大纲
// 流程：题目拆分 3-5 个研究视角 → 分视角多源检索（OpenAlex/Semantic Scholar/CrossRef/arXiv）→
// MapReduce 蒸馏 → 跨视角去重融合 → 生成大纲；文献/数据/表格持久化到工作区，供分章节生成消费
export default function SmartWriting() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState({ topic: '', field: '计算机科学', keywords: '' });
  const [projectId, setProjectId] = useState(null);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [needOrder, setNeedOrder] = useState(null);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState('outline'); // outline / refs / framework / data

  // 从工作区跳转进来时读取 projectId 与题目
  useEffect(() => {
    const pid = searchParams.get('projectId');
    const tp = searchParams.get('topic');
    if (pid) setProjectId(pid);
    if (tp) setForm((f) => ({ ...f, topic: tp }));
  }, [searchParams]);

  // 可选关联工作区：加载项目列表
  useEffect(() => {
    api.listProjects().then((d) => setProjects(d.projects || [])).catch(() => {});
  }, []);

  const run = async (orderNo) => {
    if (!form.topic.trim()) {
      setError('请填写论文题目');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    setNeedOrder(null);
    try {
      const data = await api.smartWriting({
        topic: form.topic.trim(),
        field: form.field,
        keywords: form.keywords?.trim() || undefined,
        projectId: projectId || undefined,
        orderNo: orderNo || undefined,
      });
      if (data.needOrder) {
        setNeedOrder({ itemType: data.itemType, amount: data.amount });
      } else {
        setResult(data);
        setTab('outline');
      }
    } catch (err) {
      setError(err.message || '智能写作失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyOutline = async () => {
    if (!result?.outline) return;
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(result.outline);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('复制失败，请手动复制');
    }
  };

  const framework = result?.framework || null;
  const benchmarks = result?.benchmarks?.data || [];
  const tables = result?.tables || [];
  const references = result?.references || [];

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col px-8 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-ink">
            <Brain className="h-5 w-5 text-accent" /> 智能写作（检索 → 蒸馏）
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            多视角检索真实论文，蒸馏研究框架与数据，生成基于真实文献的大纲（现金直付，需文献综述订单）
          </p>
        </div>
      </div>

      <div className="grid flex-1 gap-6 lg:grid-cols-[340px_1fr]">
        {/* 设置面板 */}
        <div className="card flex flex-col p-6">
          <div className="space-y-4">
            <div>
              <label className="label">论文题目</label>
              <textarea
                className="input min-h-[90px] resize-none"
                placeholder="例如：基于深度学习的医学影像分割方法研究"
                value={form.topic}
                onChange={(e) => setForm({ ...form, topic: e.target.value })}
              />
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
              <label className="label">关键词（可选，增强检索）</label>
              <input
                className="input"
                placeholder="如：图像分割、U-Net"
                value={form.keywords}
                onChange={(e) => setForm({ ...form, keywords: e.target.value })}
              />
            </div>
            <div>
              <label className="label">关联论文工作区（可选）</label>
              <select
                className="input"
                value={projectId || ''}
                onChange={(e) => setProjectId(e.target.value ? e.target.value : null)}
              >
                <option value="">不关联（仅生成本次大纲）</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-slate-400">
                关联后，蒸馏出的文献/数据/表格会存入工作区，分章节生成时自动引用
              </p>
            </div>
          </div>

          <div className="mt-5 flex-1" />
          <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            本功能为付费功能，先下单支付后执行（文献综述订单）
          </div>
          <button onClick={() => run()} disabled={loading} className="btn-primary w-full py-3">
            {loading ? (
              <><Refresh className="h-4 w-4 animate-spin" /> 检索与蒸馏中…（约需 1 分钟）</>
            ) : (
              <><Sparkle className="h-4 w-4" /> 开始智能写作</>
            )}
          </button>
          {error && (
            <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
          )}
        </div>

        {/* 结果面板 */}
        <div className="card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <span className="text-sm font-medium text-slate-600">
              {result ? '蒸馏结果' : '生成结果'}
            </span>
            {result && (
              <div className="flex items-center gap-1">
                {tab === 'outline' && (
                  <button onClick={handleCopyOutline} className="btn-ghost text-xs">
                    {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    {copied ? '已复制' : '复制大纲'}
                  </button>
                )}
              </div>
            )}
          </div>

          {result ? (
            <div className="flex min-h-0 flex-1 flex-col">
              {/* 状态条 */}
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-2.5 text-xs">
                <span className={`rounded px-2 py-0.5 font-medium ${result.degraded ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
                  {result.degraded ? '模板降级模式（未配置真实 AI）' : '真实 AI 蒸馏'}
                </span>
                <span className="text-slate-500">检索 {references.length} 篇文献</span>
                <span className="text-slate-500">· {framework?.paperCount || 0} 篇完成蒸馏</span>
                {framework?.perspectives_used?.length > 0 && (
                  <span className="text-slate-500">· {framework.perspectives_used.length} 个研究视角</span>
                )}
                {projectId && (
                  <span className="ml-auto flex items-center gap-1 text-accent">
                    <BadgeCheck className="h-3.5 w-3.5" /> 已存入工作区
                  </span>
                )}
              </div>

              {/* 标签页切换 */}
              <div className="flex gap-1 border-b border-slate-100 px-5 pt-2">
                {[
                  { key: 'outline', label: '大纲', icon: Layers },
                  { key: 'framework', label: '研究框架', icon: Brain },
                  { key: 'refs', label: `文献 (${references.length})`, icon: Book },
                  { key: 'data', label: `数据/表格 (${benchmarks.length + tables.length})`, icon: Table },
                ].map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-medium transition ${
                      tab === t.key
                        ? 'border-b-2 border-accent text-accent'
                        : 'text-slate-500 hover:text-ink'
                    }`}
                  >
                    <t.icon className="h-3.5 w-3.5" /> {t.label}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto p-5">
                {tab === 'outline' && (
                  <div>
                    {result.outline ? (
                      <pre className="whitespace-pre-wrap font-serif text-[14px] leading-[1.85] text-slate-700">{result.outline}</pre>
                    ) : (
                      <p className="text-sm text-slate-400">未生成大纲</p>
                    )}
                    <div className="mt-4 rounded-lg bg-accent-50 px-4 py-3 text-xs text-accent">
                      下一步：在论文工作区确认此大纲后，即可分章节生成正文（每章自动引用上述真实文献与数据）。
                      <button
                        onClick={() => navigate('/app/projects')}
                        className="ml-2 inline-flex items-center gap-1 font-semibold underline"
                      >
                        去工作区 <ArrowRight className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )}

                {tab === 'framework' && (
                  <div className="space-y-4">
                    {framework?.perspectives?.length > 0 && (
                      <div>
                        <h3 className="mb-2 text-sm font-semibold text-ink">研究视角与方法分布</h3>
                        <div className="space-y-2">
                          {framework.perspectives.map((p) => (
                            <div key={p.view} className="rounded-lg bg-slate-50 px-3 py-2">
                              <div className="text-xs font-semibold text-accent">{p.view}</div>
                              <div className="mt-1 text-xs text-slate-600">
                                {(p.methods || []).join('；') || '（无方法）'}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-ink">主要研究方法（按出现频率）</h3>
                      <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
                        {(framework?.methods || []).map((m, i) => <li key={i}>{m}</li>)}
                        {(framework?.methods || []).length === 0 && <li className="text-slate-400">（未提取到）</li>}
                      </ul>
                    </div>
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-ink">主要创新点</h3>
                      <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
                        {(framework?.innovations || []).map((m, i) => <li key={i}>{m}</li>)}
                        {(framework?.innovations || []).length === 0 && <li className="text-slate-400">（未提取到）</li>}
                      </ul>
                    </div>
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-ink">主要结论</h3>
                      <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
                        {(framework?.conclusions || []).map((m, i) => <li key={i}>{m}</li>)}
                        {(framework?.conclusions || []).length === 0 && <li className="text-slate-400">（未提取到）</li>}
                      </ul>
                    </div>
                  </div>
                )}

                {tab === 'refs' && (
                  <div className="space-y-2">
                    {references.map((r, i) => (
                      <div key={i} className="rounded-lg border border-slate-100 px-3 py-2">
                        <div className="text-sm font-medium text-ink">
                          [{i + 1}] {r.title}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {r.authors || '佚名'} · {r.journal || '未知来源'} · {r.year || '未知年份'}
                          {r.source_db && <span className="ml-2 rounded bg-slate-100 px-1 py-0.5 text-[10px]">{r.source_db}</span>}
                          {r.source_url && (
                            <a href={r.source_url} target="_blank" rel="noreferrer" className="ml-2 text-accent hover:underline">原文链接</a>
                          )}
                        </div>
                      </div>
                    ))}
                    {references.length === 0 && <p className="text-sm text-slate-400">未检索到文献（降级模式）</p>}
                  </div>
                )}

                {tab === 'data' && (
                  <div className="space-y-4">
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-ink">套用的实验数据（用于对比图表，自动标注来源）</h3>
                      {benchmarks.length > 0 ? (
                        <div className="space-y-2">
                          {benchmarks.map((b, i) => (
                            <div key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
                              <div className="font-medium text-slate-700">{b.paperTitle}（{b.paperYear}）</div>
                              <div className="mt-1 text-slate-500">
                                {(b.metrics || []).map((m) => `${m.label}=${m.value}`).join('，')}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400">摘要未提取到性能指标（可在工作区上传 Excel 数据图表）</p>
                      )}
                    </div>
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-ink">套用的表格数据（三线表，自动标注来源）</h3>
                      {tables.length > 0 ? (
                        <div className="space-y-3">
                          {tables.map((t, i) => (
                            <div key={i} className="overflow-x-auto rounded-lg border border-slate-100">
                              <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
                                数据引自：{t.source}{t.year ? `，${t.year}` : ''}
                                {t.from_mineru && <span className="ml-2 rounded bg-accent-50 px-1 py-0.5 text-[10px] text-accent">MinerU 解析</span>}
                              </div>
                              <table className="w-full text-xs">
                                <tbody>
                                  {(t.rows || []).map((row, ri) => (
                                    <tr key={ri} className={ri === 0 ? 'border-b border-slate-200 font-medium text-slate-700' : 'text-slate-600'}>
                                      {row.map((cell, ci) => (
                                        <td key={ci} className="border-r border-slate-100 px-2 py-1 last:border-r-0">{cell}</td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400">未提取到表格数据</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-50 text-accent">
                <Brain className="h-7 w-7" />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-600">填写题目后点击「开始智能写作」</p>
              <p className="mt-1 max-w-sm text-xs text-slate-400">
                系统将拆分 3-5 个研究视角，检索真实论文并蒸馏研究框架、实验数据与表格，
                生成基于真实文献的大纲供你确认
              </p>
            </div>
          )}
        </div>
      </div>

      {needOrder && (
        <FeaturePay needOrder={needOrder} onPaid={(orderNo) => run(orderNo)} />
      )}
    </div>
  );
}

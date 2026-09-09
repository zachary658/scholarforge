import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { toast } from '../components/Toast.jsx';
import {
  BookOpen, ChevronLeft, Receipt, Refresh, Cart, Info, X,
} from '../components/Icons.jsx';

const PAPER_TYPES = ['毕业论文', '课程论文', '期刊论文', '其他'];
const FORMULA_LEVELS = [
  { value: '无', label: '无', desc: '不含公式推导' },
  { value: '少量', label: '少量', desc: '少量基础公式' },
  { value: '较多', label: '较多', desc: '较多公式与推导' },
  { value: '大量', label: '大量', desc: '大量数学推导/建模' },
];

// 公式复杂度详细说明（用于弹窗）
const FORMULA_EXPLANATIONS = [
  {
    level: '无',
    title: '无公式推导',
    icon: '1',
    description: '论文中不涉及任何数学公式、方程式或推导过程。',
    examples: '适用于纯文字论述类论文，如文史哲、法学、管理学等理论分析型研究。',
    pricing: '不产生公式复杂度加价。',
  },
  {
    level: '少量',
    title: '少量基础公式',
    icon: '2',
    description: '论文中包含少量基础数学公式，如简单的统计公式、定义式、基础代数运算等。',
    examples: '适用于社科统计类论文、经济学基础模型、教育心理学等含简单定量分析的研究。',
    pricing: '在基础价上加收少量公式费用。',
  },
  {
    level: '较多',
    title: '较多公式与推导',
    icon: '3',
    description: '论文中有较多公式，包含推导过程、定理证明、算法描述等中等复杂度数学内容。',
    examples: '适用于理工科硕士论文、工程计算类、中等难度数学建模、信号处理等领域。',
    pricing: '在基础价上加收中等公式费用。',
  },
  {
    level: '大量',
    title: '大量数学推导/建模',
    icon: '4',
    description: '论文以数学推导为核心，包含大量复杂公式、多步证明、数值计算、数学建模等高难度内容。',
    examples: '适用于数学、物理、金融工程、机器学习理论、控制论等高度数理化的研究。',
    pricing: '在基础价上加收较高公式费用。',
  },
];

const emptyForm = {
  major: '',
  paper_type: '毕业论文',
  word_count: 10000,
  chart_count: 0,
  drawing_count: 0,
  formula: '无',
  urgent: false,
  note: '',
  contact: '',
  promotion_code: '',
};

function fmt(v) {
  return `¥${Number(v || 0).toFixed(2)}`;
}

export default function CourseQuote() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const courseId = searchParams.get('course');

  const [course, setCourse] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const projectId = searchParams.get('projectId');
  useEffect(() => {
    let cancelled = false;
    if (!projectId) return;
    api.getProject(projectId).then(({ project }) => {
      if (!cancelled && project) setForm(current => ({ ...current, major: project.field || '', note: `论文项目：${project.title}\n${project.writing_requirements || ''}\n希望专家帮助：` }));
    }).catch(err => toast.error(err.message));
    return () => { cancelled = true; };
  }, [projectId]);
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const debounceRef = useRef(null);
  const quoteSeqRef = useRef(0);

  // 公式复杂度弹窗状态
  const [formulaModal, setFormulaModal] = useState(null); // 待确认的 formula value

  const handleFormulaClick = (value) => {
    setFormulaModal(value);
  };

  const confirmFormula = () => {
    set({ formula: formulaModal });
    setFormulaModal(null);
  };

  const cancelFormula = () => {
    setFormulaModal(null);
  };

  const load = async () => {
    setLoading(true);
    try {
      const listData = await api.listCourses();
      const found = (listData.courses || []).find((c) => String(c.id) === String(courseId));
      if (!found) throw new Error('课程不存在或已下架');
      setCourse(found);
    } catch (err) {
      toast.error(err.message);
      navigate('/app/courses', { replace: true });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [courseId]);

  const requirements = useMemo(() => ({
    major: form.major,
    paper_type: form.paper_type,
    word_count: Number(form.word_count) || 0,
    chart_count: Number(form.chart_count) || 0,
    drawing_count: Number(form.drawing_count) || 0,
    formula: form.formula,
    urgent: !!form.urgent,
    note: form.note,
    contact: form.contact,
    promotion_code: form.promotion_code,
  }), [form]);

  // 实时报价：防抖调用后端权威计算
  // 用请求序号防竞态：旧响应（慢请求）不覆盖新报价
  useEffect(() => {
    if (!course) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const seq = ++quoteSeqRef.current;
      try {
        setQuoting(true);
        const data = await api.courseQuote({ course_id: course.id, requirements });
        if (seq === quoteSeqRef.current) setQuote(data);
      } catch {
        if (seq === quoteSeqRef.current) setQuote(null);
      } finally {
        if (seq === quoteSeqRef.current) setQuoting(false);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [course, requirements]);

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const submit = async () => {
    if (!form.major.trim()) {
      toast.warning('请填写专业方向');
      return;
    }
    setSubmitting(true);
    try {
      await api.requestCourseServiceQuote({ course_id: course.id, requirements });
      toast.success('需求已提交，客服确认服务范围后会发送正式报价');
      navigate('/app/orders');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="animate-pulse text-slate-400">加载中…</div>
      </div>
    );
  }

  // ===== 需求填写 + 报价 =====
  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <button onClick={() => navigate('/app/courses')} className="btn-ghost text-xs">
        <ChevronLeft className="h-4 w-4" /> 返回课程列表
      </button>

      <div className="mt-4 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            {course.degree && (
              <span className="rounded-md bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent">{course.degree}</span>
            )}
            <h1 className="text-xl font-bold text-ink">{course.title}</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">填写需求并提交客服复核；服务范围和正式报价确认后再付款</p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* 需求表单 */}
        <div className="card p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <BookOpen className="h-4 w-4 text-accent" /> 论文需求
          </div>

          <div className="mt-5 space-y-5">
            <div>
              <label className="label">专业方向 <span className="text-red-500">*</span></label>
              <input
                className="input"
                value={form.major}
                onChange={(e) => set({ major: e.target.value })}
                placeholder="如：计算机科学与技术、临床医学、工商管理…"
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="label">论文类型</label>
                <select className="input" value={form.paper_type} onChange={(e) => set({ paper_type: e.target.value })}>
                  {PAPER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="label">论文字数（字）</label>
                <input
                  type="number"
                  min="0"
                  step="500"
                  className="input"
                  value={form.word_count}
                  onChange={(e) => set({ word_count: e.target.value })}
                />
                <p className="mt-1.5 text-xs text-slate-400">1 万字内含在起价，超出部分按每满 1 万字加价</p>
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="label">图表数量（张）</label>
                <input
                  type="number"
                  min="0"
                  className="input"
                  value={form.chart_count}
                  onChange={(e) => set({ chart_count: e.target.value })}
                />
              </div>
              <div>
                <label className="label">图纸 / 示意图数量（张）</label>
                <input
                  type="number"
                  min="0"
                  className="input"
                  value={form.drawing_count}
                  onChange={(e) => set({ drawing_count: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="label">公式 / 数学推导复杂度</label>
              <div className="grid gap-2 sm:grid-cols-4">
                {FORMULA_LEVELS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => handleFormulaClick(f.value)}
                    className={`rounded-lg border px-3 py-2.5 text-left transition ${
                      form.formula === f.value ? 'border-accent bg-accent-50' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className={`text-sm font-medium ${form.formula === f.value ? 'text-accent' : 'text-ink'}`}>{f.label}</div>
                    <div className="mt-0.5 text-xs text-slate-400">{f.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-ink">加急服务</div>
                <div className="text-xs text-slate-400">需要更短交付周期，在总价基础上加收费用</div>
              </div>
              <button
                type="button"
                onClick={() => set({ urgent: !form.urgent })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${form.urgent ? 'bg-accent' : 'bg-slate-200'}`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${form.urgent ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>

            <div>
              <label className="label">补充说明（选填）</label>
              <textarea
                className="input"
                rows={3}
                value={form.note}
                onChange={(e) => set({ note: e.target.value })}
                placeholder="其他要求：如开题报告、答辩PPT、特殊格式规范等"
              />
            </div>

            <div>
              <label className="label">联系方式（选填）</label>
              <input
                className="input"
                value={form.contact}
                onChange={(e) => set({ contact: e.target.value })}
                placeholder="微信号 / 手机号，便于客服与您对接"
              />
            </div>
            <div>
              <label className="label">推广码（选填）</label>
              <input
                className="input uppercase"
                value={form.promotion_code}
                onChange={(e) => set({ promotion_code: e.target.value.toUpperCase() })}
                placeholder="如有推广码请填写，不影响服务价格"
                maxLength={32}
              />
              <p className="mt-1.5 text-xs text-slate-400">推广码仅用于渠道归因，付款后不可更改。</p>
            </div>
          </div>
        </div>

        {/* 报价面板 */}
        <div>
          <div className="card sticky top-24 p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Receipt className="h-4 w-4 text-accent" /> 参考估价
            </div>

            {quoting && !quote ? (
              <div className="mt-5 flex items-center gap-2 text-sm text-slate-400">
                <Refresh className="h-4 w-4 animate-spin" /> 计算中…
              </div>
            ) : quote ? (
              <div className="mt-4 space-y-2 text-sm">
                {quote.breakdown.map((b, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-slate-500">{b.label}</span>
                    <span className="text-slate-700">{fmt(b.amount)}</span>
                  </div>
                ))}
                <div className="flex items-end justify-between border-t border-slate-200 pt-3">
                  <span className="text-sm text-slate-500">合计</span>
                  <span className="text-3xl font-bold text-accent">{fmt(quote.amount)}</span>
                </div>
                {quoting && <div className="text-right text-xs text-slate-400">重新计算中…</div>}
              </div>
            ) : (
              <div className="mt-5 text-sm text-slate-400">填写需求后实时报价</div>
            )}

            <button
              onClick={submit}
              disabled={submitting || !quote}
              className="btn-primary mt-5 w-full py-3"
            >
              {submitting ? (
                <><Refresh className="h-4 w-4 animate-spin" /> 提交中…</>
              ) : (
                <><Cart className="h-4 w-4" /> 提交客服复核</>
              )}
            </button>

            <div className="mt-4 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
              <Info className="h-4 w-4 shrink-0 text-slate-400" />
              <span>此处金额仅供参考。客服会核对实际范围、学科与工时，发送一次正式报价；你确认后只需统一付款一次。</span>
            </div>
          </div>
        </div>
      </div>

      {/* 公式复杂度说明弹窗 */}
      {formulaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-[640px] max-w-full rounded-xl bg-white shadow-card">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="text-base font-semibold text-ink">公式复杂度说明</h3>
              <button onClick={cancelFormula} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-ink">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
              <p className="mb-4 text-sm text-slate-500">
                请根据你的论文实际内容选择最匹配的公式复杂度级别。以下为各层级的详细说明：
              </p>
              <div className="space-y-4">
                {FORMULA_EXPLANATIONS.map((item) => {
                  const isSelected = formulaModal === item.level;
                  return (
                    <div
                      key={item.level}
                      className={`rounded-lg border-2 px-4 py-4 transition ${
                        isSelected ? 'border-accent bg-accent-50' : 'border-slate-200'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          isSelected ? 'bg-accent text-white' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {item.icon}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h4 className={`text-sm font-semibold ${isSelected ? 'text-accent' : 'text-ink'}`}>
                              {item.title}
                            </h4>
                            {isSelected && (
                              <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-white">你的选择</span>
                            )}
                          </div>
                          <p className="mt-1.5 text-sm text-slate-600">{item.description}</p>
                          <div className="mt-2 space-y-1.5 rounded-md bg-white px-3 py-2 text-xs">
                            <div className="flex gap-2">
                              <span className="shrink-0 font-medium text-slate-500">适用场景：</span>
                              <span className="text-slate-600">{item.examples}</span>
                            </div>
                            <div className="flex gap-2">
                              <span className="shrink-0 font-medium text-slate-500">价格影响：</span>
                              <span className="text-slate-600">{item.pricing}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button onClick={cancelFormula} className="btn-secondary">取消</button>
              <button onClick={confirmFormula} className="btn-primary">
                确认选择「{FORMULA_LEVELS.find((f) => f.value === formulaModal)?.label || formulaModal}」
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

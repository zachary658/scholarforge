import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import PayModal from '../components/PayModal.jsx';
import { toast } from '../components/Toast.jsx';
import {
  BookOpen, ChevronLeft, Receipt, Wechat, Refresh, Check, Cart, Info, Copy, X,
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
};

function fmt(v) {
  return `¥${Number(v || 0).toFixed(2)}`;
}

// 复制到剪贴板（含旧浏览器降级）
async function copyText(text, label) {
  if (!text) return;
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast.success(`${label}已复制`);
    } catch {
      toast.error('复制失败，请手动复制');
    }
    document.body.removeChild(ta);
  };
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label}已复制`);
      return;
    } catch {
      fallback();
    }
  } else {
    fallback();
  }
}

export default function CourseQuote() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const courseId = searchParams.get('course');

  const [course, setCourse] = useState(null);
  const [site, setSite] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [payState, setPayState] = useState(null);
  const [success, setSuccess] = useState(null); // { order, requirements, quote }
  const debounceRef = useRef(null);

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
      const [siteData, listData] = await Promise.all([api.getSite(), api.listCourses()]);
      setSite(siteData);
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
  }), [form]);

  // 实时报价：防抖调用后端权威计算
  useEffect(() => {
    if (!course) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        setQuoting(true);
        const data = await api.courseQuote({ course_id: course.id, requirements });
        setQuote(data);
      } catch {
        setQuote(null);
      } finally {
        setQuoting(false);
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
      const data = await api.createOrder({
        type: 'course',
        target: course.id,
        courseRequirements: requirements,
      });
      setPayState(data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const onPaid = ({ order }) => {
    setPayState(null);
    setSuccess({ order, requirements, quote });
    toast.success('支付成功，请添加客服微信对接');
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="animate-pulse text-slate-400">加载中…</div>
      </div>
    );
  }

  // ===== 支付成功：客服微信对接 =====
  if (success) {
    const serviceWechat = site?.service_wechat || '';
    const serviceWechatQrcode = site?.service_wechat_qrcode || '';
    return (
      <div className="mx-auto max-w-3xl px-8 py-10">
        <div className="card p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-green-500">
            <Check className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-ink">支付成功，请添加客服微信对接</h1>
          <p className="mt-2 text-sm text-slate-500">客服将根据你的需求安排导师，请按以下步骤完成对接</p>

          {/* 三步引导 */}
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Step index="1" title="复制订单号" desc="点击下方复制订单号" />
            <Step index="2" title="添加客服微信" desc="扫码或搜索微信号添加" />
            <Step index="3" title="备注订单号" desc="发送订单号与需求给客服" />
          </div>

          {/* 订单号复制 */}
          <div className="mt-6 flex items-center justify-between rounded-xl border border-accent-100 bg-accent-50 px-4 py-3">
            <div className="min-w-0 text-left">
              <div className="text-xs text-slate-500">订单号</div>
              <div className="mt-0.5 truncate font-mono text-sm font-medium text-ink">{success.order?.order_no}</div>
            </div>
            <button
              onClick={() => copyText(success.order?.order_no, '订单号')}
              className="btn-secondary shrink-0 px-3 py-2 text-xs"
            >
              <Copy className="h-3.5 w-3.5" /> 复制
            </button>
          </div>

          {serviceWechatQrcode && (
            <div className="mx-auto mt-6 w-fit rounded-xl border border-slate-200 bg-white p-3">
              <img src={serviceWechatQrcode} alt="客服微信二维码" className="h-52 w-52 object-contain" />
              <div className="mt-1 text-xs text-slate-400">扫码添加客服微信</div>
            </div>
          )}
          {serviceWechat && (
            <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
              <div className="min-w-0 text-left">
                <div className="text-xs text-slate-500">客服微信号</div>
                <div className="mt-0.5 truncate text-sm font-semibold text-accent">{serviceWechat}</div>
              </div>
              <button
                onClick={() => copyText(serviceWechat, '微信号')}
                className="btn-secondary shrink-0 px-3 py-2 text-xs"
              >
                <Copy className="h-3.5 w-3.5" /> 复制
              </button>
            </div>
          )}
          {!serviceWechatQrcode && !serviceWechat && (
            <div className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
              客服微信暂未配置，请联系站点管理员
            </div>
          )}

          <div className="mt-8 rounded-xl bg-slate-50 p-5 text-left">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Receipt className="h-4 w-4 text-accent" /> 需求确认单
            </div>
            <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Item label="课程" value={course.title} />
              <Item label="专业" value={success.requirements.major} />
              <Item label="论文类型" value={success.requirements.paper_type} />
              <Item label="论文字数" value={`${success.requirements.word_count} 字`} />
              <Item label="图表 / 图纸" value={`${success.requirements.chart_count} 张 / ${success.requirements.drawing_count} 张`} />
              <Item label="公式复杂度" value={success.requirements.formula} />
              <Item label="加急" value={success.requirements.urgent ? '是' : '否'} />
              <Item label="支付金额" value={fmt(success.order?.amount)} strong />
            </dl>
            {success.requirements.note && (
              <div className="mt-4 border-t border-slate-200 pt-3 text-sm">
                <span className="text-slate-500">补充说明：</span>
                <span className="text-ink">{success.requirements.note}</span>
              </div>
            )}
          </div>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <button onClick={() => navigate('/app/courses')} className="btn-secondary">
              <BookOpen className="h-4 w-4" /> 返回课程
            </button>
            <button onClick={() => navigate('/app/orders')} className="btn-primary">
              <Receipt className="h-4 w-4" /> 查看订单
            </button>
          </div>
        </div>
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
          <p className="mt-1 text-sm text-slate-500">填写论文需求，系统将根据需求实时计算报价；支付后添加客服微信对接导师</p>
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
          </div>
        </div>

        {/* 报价面板 */}
        <div>
          <div className="card sticky top-24 p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Receipt className="h-4 w-4 text-accent" /> 报价明细
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
                <><Cart className="h-4 w-4" /> 提交并支付 {quote ? fmt(quote.amount) : ''}</>
              )}
            </button>

            <div className="mt-4 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
              <Info className="h-4 w-4 shrink-0 text-slate-400" />
              <span>支付完成后将展示客服微信二维码，添加后备注订单号即可对接导师。</span>
            </div>
          </div>
        </div>
      </div>

      {payState && (
        <PayModal
          order={payState.order}
          payParams={payState.payParams}
          onClose={() => setPayState(null)}
          onPaid={onPaid}
        />
      )}

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

function Item({ label, value, strong = false }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className={`mt-0.5 ${strong ? 'text-base font-bold text-accent' : 'text-ink'}`}>{value}</dd>
    </div>
  );
}

function Step({ index, title, desc }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-left">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">{index}</span>
        <span className="text-sm font-semibold text-ink">{title}</span>
      </div>
      <p className="mt-2 text-xs text-slate-500">{desc}</p>
    </div>
  );
}

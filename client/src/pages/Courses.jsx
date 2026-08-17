import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { toast } from '../components/Toast.jsx';
import { Book, BookOpen, Check, Gift, Refresh, Wechat, ArrowRight, Receipt } from '../components/Icons.jsx';

const DEGREE_ORDER = ['本科', '硕士', '博士', '其他'];

const CONTACT_BADGE = {
  pending: 'bg-amber-50 text-amber-600',
  contacted: 'bg-blue-50 text-blue-600',
  completed: 'bg-green-50 text-green-600',
};

const CONTACT_LABEL = {
  pending: '待客服对接',
  contacted: '已对接',
  completed: '已完成',
};

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts) * 1000);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('zh-CN');
}

function reqSummary(r) {
  if (!r) return null;
  const parts = [`${r.major || '未填专业'}`, `${r.paper_type || '毕业论文'}`];
  if (r.word_count) parts.push(`${r.word_count} 字`);
  if (r.chart_count) parts.push(`图表 ${r.chart_count} 张`);
  if (r.drawing_count) parts.push(`图纸 ${r.drawing_count} 张`);
  if (r.urgent) parts.push('加急');
  return parts.join(' · ');
}

export default function Courses() {
  const navigate = useNavigate();
  const [courses, setCourses] = useState([]);
  const [myCourses, setMyCourses] = useState([]);
  const [serviceWechat, setServiceWechat] = useState('');
  const [serviceWechatQrcode, setServiceWechatQrcode] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [siteData, listData, myData] = await Promise.all([
        api.getSite(),
        api.listCourses(),
        api.myCourses(),
      ]);
      setServiceWechat(siteData.service_wechat || '');
      setServiceWechatQrcode(siteData.service_wechat_qrcode || '');
      setCourses(listData.courses || []);
      setMyCourses(myData.courses || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // 按学历分组（保持后台排序）
  const groups = [];
  const seen = new Set();
  for (const c of courses) {
    const deg = c.degree || '其他';
    if (!seen.has(deg)) {
      seen.add(deg);
      groups.push({ degree: deg, items: [] });
    }
    groups.find((g) => g.degree === deg).items.push(c);
  }
  groups.sort((a, b) => {
    const ia = DEGREE_ORDER.indexOf(a.degree);
    const ib = DEGREE_ORDER.indexOf(b.degree);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">论文 1 对 1 指导</h1>
          <p className="mt-1 text-sm text-slate-500">选择学历课程，填写需求实时报价，支付后客服微信对接导师</p>
        </div>
        <button onClick={load} className="btn-ghost text-xs">
          <Refresh className="h-4 w-4" /> 刷新
        </button>
      </div>

      {/* 购买流程说明 */}
      <div className="mt-6 flex items-center gap-4 rounded-xl border border-accent-100 bg-accent-50 px-5 py-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
          <Wechat className="h-5 w-5" />
        </div>
        <div className="text-sm text-slate-600">
          <div className="font-semibold text-ink">定制流程：选择学历 → 填写需求 → 实时报价 → 支付 → 客服微信对接</div>
          <div className="mt-0.5">
            支付完成后将展示客服二维码，添加后备注订单号即可。如有疑问也可直接咨询：
            {serviceWechat ? (
              <span className="font-semibold text-accent"> {serviceWechat}</span>
            ) : (
              <span className="text-slate-400"> 客服微信暂未配置</span>
            )}
          </div>
        </div>
        {serviceWechatQrcode && (
          <img src={serviceWechatQrcode} alt="客服微信二维码" className="ml-auto h-16 w-16 shrink-0 rounded-lg border border-slate-200 bg-white object-contain" />
        )}
      </div>

      {/* 我的已购课程 */}
      {myCourses.length > 0 && (
        <div className="mt-8">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Gift className="h-4 w-4 text-accent" /> 我的已购课程
          </h2>
          <div className="mt-4 space-y-3">
            {myCourses.map((c) => (
              <div key={c.user_course_id} className="card p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-ink">{c.title}</h3>
                    {c.requirements && (
                      <div className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-500">
                        <Receipt className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span>{reqSummary(c.requirements)}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`rounded-md px-2 py-0.5 text-xs ${c.expired ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                      {c.expired ? '已过期' : '有效'}
                    </span>
                    {c.contact_status && (
                      <span className={`rounded-md px-2 py-0.5 text-xs ${CONTACT_BADGE[c.contact_status] || 'bg-slate-100 text-slate-600'}`}>
                        {CONTACT_LABEL[c.contact_status] || c.contact_status}
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-3 text-xs text-slate-400">
                  购买于 {fmtDate(c.purchased_at)}
                  {c.expires_at ? ` · 有效期至 ${fmtDate(c.expires_at)}` : ' · 长期有效'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 可购买课程（按学历分组） */}
      <div className="mt-8">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Book className="h-4 w-4 text-accent" /> 选择学历，定制你的论文指导
        </h2>
        {loading ? (
          <div className="card mt-4 p-10 text-center text-sm text-slate-400">加载中…</div>
        ) : courses.length === 0 ? (
          <div className="card mt-4 p-10 text-center text-sm text-slate-400">暂无课程</div>
        ) : (
          <div className="mt-4 space-y-6">
            {groups.map((g) => (
              <div key={g.degree}>
                <div className="mb-3 flex items-center gap-2">
                  <span className="rounded-md bg-accent-50 px-2.5 py-1 text-xs font-semibold text-accent">{g.degree}</span>
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {g.items.map((c) => (
                    <div key={c.id} className="card flex flex-col p-6">
                      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent-50 text-accent">
                        <Book className="h-[22px] w-[22px]" />
                      </div>
                      <h3 className="mt-4 text-base font-semibold text-ink">{c.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-slate-500">{c.description}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                        {c.duration_text && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1">
                            <BookOpen className="h-3 w-3" /> {c.duration_text}
                          </span>
                        )}
                        {c.validity_days ? (
                          <span className="rounded-md bg-slate-100 px-2 py-1">有效期 {c.validity_days} 天</span>
                        ) : (
                          <span className="rounded-md bg-slate-100 px-2 py-1">长期有效</span>
                        )}
                      </div>
                      <div className="mt-5 flex items-end justify-between border-t border-slate-100 pt-4">
                        <div>
                          <div className="text-xs text-slate-400">价格</div>
                          <div className="text-2xl font-bold text-accent">¥{Number(c.price).toFixed(2)}<span className="ml-0.5 text-sm font-medium text-slate-400">起</span></div>
                        </div>
                      </div>
                      <button
                        onClick={() => navigate(`/app/courses/quote?course=${c.id}`)}
                        className="btn-primary mt-4 w-full"
                      >
                        {c.purchased ? (
                          <><Check className="h-4 w-4" /> 再次定制</>
                        ) : (
                          <>立即定制 <ArrowRight className="h-4 w-4" /></>
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

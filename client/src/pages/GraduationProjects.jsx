import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { toast } from '../components/Toast.jsx';
import {
  Refresh, Check, ArrowRight, Receipt, Wechat, BookOpen, Gift,
  Grid, Cpu, Settings, FileText, Sliders, Info,
} from '../components/Icons.jsx';

const CATEGORY_ICON = {
  '建筑图纸': Grid,
  '机械图纸': Settings,
  '仿真模拟': Cpu,
  '计算机程序': FileText,
  'PLC设计': Sliders,
  '其他': Info,
};

const CATEGORY_COLOR = {
  '建筑图纸': 'bg-amber-50 text-amber-600',
  '机械图纸': 'bg-slate-100 text-slate-600',
  '仿真模拟': 'bg-blue-50 text-blue-600',
  '计算机程序': 'bg-accent-50 text-accent',
  'PLC设计': 'bg-emerald-50 text-emerald-600',
  '其他': 'bg-violet-50 text-violet-600',
};

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

export default function GraduationProjects() {
  const [categories, setCategories] = useState([]);
  const [projects, setProjects] = useState([]);
  const [myOrders, setMyOrders] = useState([]);
  const [serviceWechat, setServiceWechat] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedProject, setSelectedProject] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [remark, setRemark] = useState('');
  const [contact, setContact] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [siteData, projData, orderData] = await Promise.all([
        api.getSite(),
        api.listGraduationProjects(),
        api.myGraduationOrders().catch(() => ({ orders: [] })),
      ]);
      setServiceWechat(siteData.service_wechat || '');
      setCategories(projData.categories || []);
      setProjects(projData.projects || []);
      setMyOrders(orderData.orders || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const grouped = {};
  const allCategories = new Set();
  for (const p of projects) {
    const cat = p.category || '其他';
    allCategories.add(cat);
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(p);
  }

  const filteredCategories = activeCategory === 'all'
    ? [...allCategories]
    : [activeCategory];

  const openDetail = (project) => {
    setSelectedProject(project);
    setRemark('');
    setContact('');
    setShowModal(true);
  };

  const submitOrder = async () => {
    if (!selectedProject) return;
    setSubmitting(true);
    try {
      await api.createGraduationOrder(selectedProject.id, { remark, contact });
      toast.success('需求已提交，客服将尽快与您联系');
      setShowModal(false);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">毕业作品指导制作</h1>
          <p className="mt-1 text-sm text-slate-500">
            覆盖建筑图纸、机械图纸、仿真模拟、计算机程序、PLC设计等方向，选择分类查看可订购项目
          </p>
        </div>
        <button onClick={load} className="btn-ghost text-xs">
          <Refresh className="h-4 w-4" /> 刷新
        </button>
      </div>

      {/* 流程说明 */}
      <div className="mt-6 flex items-center gap-4 rounded-xl border border-accent-100 bg-accent-50 px-5 py-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
          <Wechat className="h-5 w-5" />
        </div>
        <div className="text-sm text-slate-600">
          <div className="font-semibold text-ink">定制流程：选择分类 → 浏览项目 → 联系客服 → 确认需求 → 支付 → 交付</div>
          <div className="mt-0.5">
            选择感兴趣的项目后，可联系客服获取详细报价与定制方案：
            {serviceWechat ? (
              <span className="font-semibold text-accent"> {serviceWechat}</span>
            ) : (
              <span className="text-slate-400"> 客服微信暂未配置</span>
            )}
          </div>
        </div>
      </div>

      {/* 我的已购项目 */}
      {myOrders.length > 0 && (
        <div className="mt-8">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Gift className="h-4 w-4 text-accent" /> 我的已购毕业作品
          </h2>
          <div className="mt-4 space-y-3">
            {myOrders.map((o) => (
              <div key={o.id} className="card p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-ink">{o.project_title}</h3>
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{o.category}</span>
                    </div>
                    {o.requirements?.remark && (
                      <div className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-500">
                        <Receipt className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="line-clamp-2">{o.requirements.remark}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {o.quoted_price != null && (
                      <span className="rounded-md bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent">
                        报价 ¥{Number(o.quoted_price).toFixed(2)}
                      </span>
                    )}
                    {o.contact_status && (
                      <span className={`rounded-md px-2 py-0.5 text-xs ${CONTACT_BADGE[o.contact_status] || 'bg-slate-100 text-slate-600'}`}>
                        {CONTACT_LABEL[o.contact_status] || o.contact_status}
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-3 text-xs text-slate-400">
                  购买于 {fmtDate(o.purchased_at)}
                  {o.expires_at ? ` · 有效期至 ${fmtDate(o.expires_at)}` : ' · 长期有效'}
                  {o.order_no && <span className="ml-2 font-mono">订单号: {o.order_no}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 分类筛选 */}
      <div className="mt-8">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <BookOpen className="h-4 w-4 text-accent" /> 选择分类，浏览可定制项目
        </h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => setActiveCategory('all')}
            className={`rounded-lg px-3.5 py-2 text-xs font-medium transition ${
              activeCategory === 'all'
                ? 'bg-accent text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            全部
          </button>
          {categories.map((cat) => {
            const Icon = CATEGORY_ICON[cat.key] || Info;
            return (
              <button
                key={cat.key}
                onClick={() => setActiveCategory(cat.key)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition ${
                  activeCategory === cat.key
                    ? 'bg-accent text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {cat.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 项目列表 */}
      <div className="mt-6">
        {loading ? (
          <div className="card p-10 text-center text-sm text-slate-400">加载中…</div>
        ) : projects.length === 0 ? (
          <div className="card p-10 text-center text-sm text-slate-400">暂无项目</div>
        ) : (
          <div className="space-y-8">
            {filteredCategories.map((cat) => {
              const items = grouped[cat] || [];
              if (items.length === 0) return null;
              const catInfo = categories.find((c) => c.key === cat);
              const Icon = CATEGORY_ICON[cat] || Info;
              const color = CATEGORY_COLOR[cat] || 'bg-slate-100 text-slate-600';
              return (
                <div key={cat}>
                  <div className="mb-3 flex items-center gap-2">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <span className="text-sm font-semibold text-ink">{cat}</span>
                      {catInfo?.desc && (
                        <p className="text-xs text-slate-400">{catInfo.desc}</p>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {items.map((p) => {
                      const purchased = p.purchased;
                      const CatIcon = CATEGORY_ICON[p.category] || Info;
                      const catColor = CATEGORY_COLOR[p.category] || 'bg-slate-100 text-slate-600';
                      return (
                        <div key={p.id} className="card flex flex-col p-6">
                          <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${catColor}`}>
                            <CatIcon className="h-[22px] w-[22px]" />
                          </div>
                          <h3 className="mt-4 text-base font-semibold text-ink">{p.title}</h3>
                          <p className="mt-2 text-sm leading-relaxed text-slate-500 line-clamp-2">
                            {p.description || '暂无描述'}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                            <span className="rounded-md bg-slate-100 px-2 py-1">{p.category}</span>
                            {p.duration_text && (
                              <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1">
                                <BookOpen className="h-3 w-3" /> {p.duration_text}
                              </span>
                            )}
                            {p.degree && (
                              <span className="rounded-md bg-slate-100 px-2 py-1">{p.degree}</span>
                            )}
                          </div>
                          <div className="mt-5 flex items-end justify-between border-t border-slate-100 pt-4">
                            <div>
                              <div className="text-xs text-slate-400">参考价格</div>
                              <div className="text-2xl font-bold text-accent">
                                ¥{Number(p.base_price).toFixed(2)}
                                <span className="ml-0.5 text-sm font-medium text-slate-400">起</span>
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => openDetail(p)}
                            className="btn-primary mt-4 w-full"
                          >
                            {purchased ? (
                              <><Check className="h-4 w-4" /> 再次定制</>
                            ) : (
                              <>了解详情 <ArrowRight className="h-4 w-4" /></>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 项目详情弹窗 */}
      {showModal && selectedProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowModal(false)}
          />
          <div className="relative mx-4 w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start gap-4">
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
                CATEGORY_COLOR[selectedProject.category] || 'bg-slate-100 text-slate-600'
              }`}>
                {(() => {
                  const Icon = CATEGORY_ICON[selectedProject.category] || Info;
                  return <Icon className="h-6 w-6" />;
                })()}
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-ink">{selectedProject.title}</h3>
                <div className="mt-1 flex flex-wrap gap-2">
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    {selectedProject.category}
                  </span>
                  {selectedProject.degree && (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                      {selectedProject.degree}
                    </span>
                  )}
                  {selectedProject.duration_text && (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                      {selectedProject.duration_text}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <p className="text-sm leading-relaxed text-slate-600">
                {selectedProject.description || '暂无详细描述'}
              </p>
            </div>

            <div className="mt-5 rounded-lg bg-slate-50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">参考价格</span>
                <span className="text-2xl font-bold text-accent">
                  ¥{Number(selectedProject.base_price).toFixed(2)}
                  <span className="ml-0.5 text-sm font-medium text-slate-400">起</span>
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-400">
                实际价格根据需求复杂度浮动，请联系客服获取精确报价
              </div>
            </div>

            {serviceWechat && (
              <div className="mt-4 flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                <Wechat className="h-5 w-5 shrink-0 text-green-600" />
                <div className="text-sm">
                  <div className="font-medium text-green-800">联系客服定制</div>
                  <div className="text-green-700">微信：{serviceWechat}</div>
                </div>
              </div>
            )}

            <div className="mt-4">
              <label className="label">定制需求说明（选填）</label>
              <textarea
                className="input min-h-[80px] resize-y"
                placeholder="请描述课题方向、专业、时间要求等，便于客服快速评估报价"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
              />
              <input
                className="input mt-2"
                placeholder="微信号 / 手机号（便于客服与您联系）"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
              />
            </div>

            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="btn-secondary flex-1"
              >
                关闭
              </button>
              <button
                onClick={submitOrder}
                disabled={submitting}
                className="btn-primary flex-1 disabled:opacity-50"
              >
                {submitting ? '提交中…' : '提交定制需求'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
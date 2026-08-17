import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import {
  Logo, Pen, Book, FileWord, Check, ArrowRight, Sparkle, Cart, Crown,
  Shield, FileText, Layers, Refresh, BookOpen, Wechat, Grid, Cpu, Settings, Sliders, Info,
} from '../components/Icons.jsx';

// 借鉴千笔写作：全流程闭环步骤
const pipeline = [
  { step: 1, title: '选题立意', desc: '工作区记录题目、学科、写作要求', icon: Pen },
  { step: 2, title: '大纲生成', desc: '免费不限次，3 级结构化大纲', icon: Layers, free: true },
  { step: 3, title: '正文撰写', desc: '段落续写 / 全文生成 / 文献综述', icon: FileWord },
  { step: 4, title: '降重', desc: '同义改写降低重复率', icon: Refresh },
  { step: 5, title: '降AI率', desc: '智能改写消除 AI 痕迹', icon: Shield },
  { step: 6, title: '格式导出', desc: '按高校模板一键导出 Word', icon: FileText },
];

export default function Landing() {
  const { user } = useAuth();
  const [site, setSite] = useState(null);
  const [gradProjects, setGradProjects] = useState([]);

  useEffect(() => {
    api.getSite().then(setSite).catch(() => {});
    api.listGraduationProjectsPublic().then((d) => setGradProjects(d.projects || [])).catch(() => {});
  }, []);

  const ctaLink = user ? '/app' : '/register';
  const points_packages = site?.points_packages || [];
  const signupPoints = site?.signup_points ?? 30;
  const siteName = site?.site_name || 'ScholarForge';
  const siteDesc = site?.site_description || 'AI 驱动的学术写作辅助平台';
  const courses = site?.courses || [];
  const serviceWechat = site?.service_wechat || '';
  const serviceWechatQrcode = site?.service_wechat_qrcode || '';

  const CATEGORY_ICON = {
    '建筑图纸': Grid,
    '机械图纸': Settings,
    '仿真模拟': Cpu,
    '计算机程序': FileText,
    'PLC设计': Sliders,
    '其他': Info,
  };

  const presetCount = site?.preset_templates_count || 0;

  return (
    <div className="min-h-screen bg-[#F7F5F0] font-sans">
      {/* 导航栏 */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0B1120]/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <Logo className="h-8 w-8" />
            <span className="text-[17px] font-bold tracking-tight text-white">{siteName}</span>
          </div>
          <nav className="hidden items-center gap-8 md:flex">
            <a href="#courses" className="text-sm font-medium text-slate-300 transition hover:text-white">论文辅导</a>
            <a href="#graduation" className="text-sm font-medium text-slate-300 transition hover:text-white">作品设计辅导</a>
            <a href="#points" className="text-sm font-medium text-slate-300 transition hover:text-white">积分充值</a>
            <a href="#pipeline" className="text-sm font-medium text-slate-300 transition hover:text-white">全流程</a>
            {user?.is_admin && <Link to="/admin" className="text-sm font-medium text-indigo-300 transition hover:text-white">管理后台</Link>}
            {user && !user?.is_admin && <Link to="/app" className="text-sm font-medium text-slate-300 transition hover:text-white">工作台</Link>}
            {!user && <Link to="/login" className="text-sm font-medium text-slate-300 transition hover:text-white">登录</Link>}
          </nav>
          <Link
            to={ctaLink}
            className="group inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-indigo-900/40 transition hover:from-indigo-400 hover:to-violet-400"
          >
            {user ? '进入工作台' : '注册送积分'}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </header>

      {site?.announcement && (
        <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-2 text-center text-sm text-white">
          {site.announcement}
        </div>
      )}

      {/* Hero */}
      <section className="noise relative overflow-hidden bg-[#0B1120] text-white">
        <div className="hero-grid absolute inset-0" />
        {/* 光晕 */}
        <div className="animate-glow absolute -left-24 top-0 h-[420px] w-[420px] rounded-full bg-indigo-600/30 blur-[120px]" />
        <div className="animate-glow absolute -right-24 top-10 h-[380px] w-[380px] rounded-full bg-violet-600/25 blur-[120px]" style={{ animationDelay: '1.5s' }} />

        <div className="relative mx-auto max-w-6xl px-6 pt-24 pb-20">
          <div className="grid items-center gap-14 lg:grid-cols-2">
            <div>
              <div className="animate-fade-up mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs font-medium text-slate-300 backdrop-blur">
                <Sparkle className="h-3.5 w-3.5 text-indigo-300" />
                {siteDesc}
              </div>
              <h1 className="animate-fade-up text-[52px] font-extrabold leading-[1.08] tracking-tight" style={{ animationDelay: '0.08s' }}>
                10 分钟出稿
                <br />
                <span className="bg-gradient-to-r from-indigo-300 via-violet-300 to-sky-300 bg-clip-text text-transparent">真实文献可溯源</span>
              </h1>
              <p className="animate-fade-up mt-6 max-w-md text-lg leading-relaxed text-slate-400" style={{ animationDelay: '0.16s' }}>
                集成 AI 论文写作、开题报告、文献综述、答辩PPT、降重、降AI率于一体。注册即送 {signupPoints} 积分，真实参考文献可溯源，写作内容一键导出 Word。
              </p>

              {/* 核心卖点标签 */}
              <div className="animate-fade-up mt-7 flex flex-wrap gap-3 text-xs" style={{ animationDelay: '0.24s' }}>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 font-medium text-emerald-300">
                  <Check className="h-3.5 w-3.5" />大纲生成免费不限次
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/20 bg-indigo-400/10 px-3 py-1 font-medium text-indigo-300">
                  <Check className="h-3.5 w-3.5" />Word一键导出
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/20 bg-rose-400/10 px-3 py-1 font-medium text-rose-300">
                  <Check className="h-3.5 w-3.5" />真实文献可溯源
                </span>
                {presetCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 font-medium text-slate-300">
                    <Check className="h-3.5 w-3.5" />{presetCount}+ 高校模板
                  </span>
                )}
              </div>

              <div className="animate-fade-up mt-9 flex items-center gap-4" style={{ animationDelay: '0.32s' }}>
                <Link
                  to={ctaLink}
                  className="group inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 px-6 py-3.5 text-base font-semibold text-white shadow-xl shadow-indigo-900/40 transition hover:from-indigo-400 hover:to-violet-400"
                >
                  {user ? '进入工作台' : `注册送 ${signupPoints} 积分`}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
                <a href="#points" className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-6 py-3.5 text-base font-medium text-white transition hover:bg-white/10">
                  积分充值
                </a>
              </div>
            </div>

            {/* 示例文档卡片 */}
            <div className="animate-fade-up relative hidden lg:block" style={{ animationDelay: '0.2s' }}>
              <div className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-indigo-500/20 to-violet-500/10 blur-2xl" />
              <div className="animate-float relative overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl">
                <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-4 py-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                  <span className="h-2.5 w-2.5 rounded-full bg-green-300" />
                  <span className="ml-3 text-xs text-slate-400">深度学习在医学影像中的应用.docx</span>
                </div>
                <div className="p-6 font-serif text-[13px] leading-relaxed text-slate-700">
                  <div className="text-base font-semibold text-ink">摘要</div>
                  <p className="mt-2">
                    本文围绕深度学习在医学影像分割中的应用展开系统研究，旨在揭示其作用机制与实践价值。研究基于相关理论框架，构建了包含核心变量与调节因素的分析模型，并采用实证方法对研究假设进行检验。
                  </p>
                  <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50 p-3 font-sans text-xs text-indigo-700">
                    <span className="font-semibold">AI 建议：</span>建议在"作用机制"后补充具体的技术路径，增强论证链条完整性。
                  </div>
                  <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 font-sans text-xs text-emerald-700">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <Book className="h-3.5 w-3.5" />真实文献（可溯源）
                    </div>
                    <p className="mt-1">张伟, 李娜. 深度学习在医学影像分割中的应用研究[J]. 计算机学报, 2023. <span className="text-emerald-600">来源：中国知网 CNKI</span></p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 全流程闭环 */}
      <section id="pipeline" className="bg-[#F7F5F0]">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">Workflow</div>
            <h2 className="text-3xl font-bold tracking-tight text-ink">写作全流程闭环</h2>
            <p className="mt-3 text-slate-500">从选题立意到格式导出，6 步搞定一篇论文，无需切换工具</p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-3 lg:grid-cols-6">
            {pipeline.map((p, i) => (
              <div key={p.step} className="group relative rounded-2xl border border-slate-200 bg-white p-5 shadow-soft transition duration-300 hover:-translate-y-1 hover:shadow-card">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-600">{p.step}</span>
                  {p.free && (
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">免费</span>
                  )}
                </div>
                <div className="mt-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-50 to-violet-50 text-indigo-600 transition group-hover:from-indigo-500 group-hover:to-violet-500 group-hover:text-white">
                  <p.icon className="h-[18px] w-[18px]" />
                </div>
                <h3 className="mt-3 text-sm font-semibold text-ink">{p.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">{p.desc}</p>
                {i < pipeline.length - 1 && (
                  <ArrowRight className="absolute -right-3 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-slate-300 lg:block" />
                )}
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Link to={ctaLink} className="group inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800">
              <Layers className="h-4 w-4" /> 立即开启全流程
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* 论文辅导 */}
      <section id="courses" className="bg-white">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
              <BookOpen className="h-3.5 w-3.5" />论文辅导
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-ink">资深导师一对一，全程辅导至定稿</h2>
            <p className="mt-3 text-slate-500">选题把关、大纲搭建、逐章修改、格式规范与答辩辅导，购买请添加客服微信详聊</p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {courses.length === 0 && (
              <div className="col-span-full rounded-2xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">
                暂未上架课程
              </div>
            )}
            {courses.map((c) => (
              <div key={c.id} className="group relative flex flex-col rounded-2xl border border-slate-200 bg-white p-7 shadow-soft transition duration-300 hover:-translate-y-1 hover:border-indigo-200 hover:shadow-card">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/20">
                  <BookOpen className="h-[22px] w-[22px]" />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-ink">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{c.description}</p>
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
                  {c.duration_text && (
                    <span className="rounded-md bg-slate-100 px-2 py-1">时长 {c.duration_text}</span>
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
                    <div className="text-2xl font-bold text-indigo-600">¥{Number(c.price).toFixed(2)}<span className="ml-0.5 text-sm font-medium text-slate-400">起</span></div>
                  </div>
                </div>
                <Link
                  to={`/app/courses/quote?course=${c.id}`}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
                >
                  立即定制 <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ))}
          </div>

          {/* 购买方式 */}
          <div className="mt-10 flex flex-col items-center justify-center gap-4 rounded-2xl border border-indigo-100 bg-indigo-50/60 px-6 py-6 sm:flex-row sm:text-left">
            {serviceWechatQrcode && (
              <img src={serviceWechatQrcode} alt="客服微信二维码" className="h-28 w-28 shrink-0 rounded-lg border border-slate-200 bg-white object-contain" />
            )}
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white">
                <Wechat className="h-6 w-6" />
              </div>
              <div>
                <div className="font-semibold text-ink">课程购买请添加客服微信详聊</div>
                <div className="mt-0.5 text-sm text-slate-600">
                  {serviceWechat ? (
                    <>
                      微信号：<span className="font-semibold text-indigo-600">{serviceWechat}</span>
                      <span className="ml-2 text-xs text-slate-400">添加后请备注「课程咨询」</span>
                    </>
                  ) : (
                    <span className="text-slate-400">客服微信暂未配置，请联系站点管理员</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 作品设计辅导 */}
      <section id="graduation" className="bg-[#F7F5F0]">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-xs font-medium text-purple-600">
              <Cpu className="h-3.5 w-3.5" />作品设计辅导
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-ink">毕业设计作品，专业导师全程指导</h2>
            <p className="mt-3 text-slate-500">覆盖建筑图纸、机械图纸、仿真模拟、计算机程序、PLC设计等多领域，购买请添加客服微信详聊</p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {gradProjects.length === 0 && (
              <div className="col-span-full rounded-2xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">
                暂未上架毕业作品项目
              </div>
            )}
            {gradProjects.map((p) => {
              const Icon = CATEGORY_ICON[p.category] || Info;
              return (
                <div key={p.id} className="group relative flex flex-col rounded-2xl border border-slate-200 bg-white p-7 shadow-soft transition duration-300 hover:-translate-y-1 hover:border-purple-200 hover:shadow-card">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-fuchsia-500 text-white shadow-lg shadow-purple-500/20">
                    <Icon className="h-[22px] w-[22px]" />
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-ink">{p.title}</h3>
                    <span className="shrink-0 rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-medium text-purple-600">{p.category}</span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-slate-500">{p.description}</p>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
                    {p.duration_text && (
                      <span className="rounded-md bg-slate-100 px-2 py-1">周期 {p.duration_text}</span>
                    )}
                    {p.degree && (
                      <span className="rounded-md bg-slate-100 px-2 py-1">{p.degree}</span>
                    )}
                  </div>
                  <div className="mt-5 flex items-end justify-between border-t border-slate-100 pt-4">
                    <div>
                      <div className="text-xs text-slate-400">基础价格</div>
                      <div className="text-2xl font-bold text-purple-600">¥{Number(p.base_price).toFixed(2)}<span className="ml-0.5 text-sm font-medium text-slate-400">起</span></div>
                    </div>
                  </div>
                  <Link
                    to={user ? '/app/graduation' : '/register'}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
                  >
                    了解详情 <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              );
            })}
          </div>

          {/* 购买方式 */}
          <div className="mt-10 flex flex-col items-center justify-center gap-4 rounded-2xl border border-purple-100 bg-purple-50/60 px-6 py-6 sm:flex-row sm:text-left">
            {serviceWechatQrcode && (
              <img src={serviceWechatQrcode} alt="客服微信二维码" className="h-28 w-28 shrink-0 rounded-lg border border-slate-200 bg-white object-contain" />
            )}
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-purple-600 text-white">
                <Wechat className="h-6 w-6" />
              </div>
              <div>
                <div className="font-semibold text-ink">毕业作品指导请添加客服微信详聊</div>
                <div className="mt-0.5 text-sm text-slate-600">
                  {serviceWechat ? (
                    <>
                      微信号：<span className="font-semibold text-purple-600">{serviceWechat}</span>
                      <span className="ml-2 text-xs text-slate-400">添加后请备注「毕业作品」</span>
                    </>
                  ) : (
                    <span className="text-slate-400">客服微信暂未配置，请联系站点管理员</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 积分充值 */}
      <section id="points" className="bg-white">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-amber-500">Credits</div>
            <h2 className="text-3xl font-bold tracking-tight text-ink">积分充值</h2>
            <p className="mt-3 text-slate-500">充值积分，跨功能通用，按需使用</p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {points_packages.length === 0 && (
              <div className="col-span-full rounded-2xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">
                暂未上架积分包
              </div>
            )}
            {points_packages.map((p) => (
              <div key={p.id} className="group relative flex flex-col rounded-2xl border border-slate-200 bg-white p-7 shadow-soft transition duration-300 hover:-translate-y-1 hover:border-amber-200 hover:shadow-card">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-500/20">
                  <Cart className="h-[22px] w-[22px]" />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-ink">{p.title}</h3>
                {p.description && <p className="mt-2 text-sm leading-relaxed text-slate-500">{p.description}</p>}
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-extrabold text-ink">¥{Number(p.price).toFixed(2)}</span>
                </div>
                <ul className="mt-5 space-y-2 text-sm text-slate-600">
                  <li className="flex items-center gap-2"><Crown className="h-4 w-4 text-amber-500" />赠送 {p.points_granted} 积分</li>
                  {p.validity_days && (
                    <li className="flex items-center gap-2"><Check className="h-4 w-4 text-indigo-600" />有效期 {p.validity_days} 天</li>
                  )}
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-indigo-600" />积分跨功能通用</li>
                </ul>
                <Link to={ctaLink} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800">
                  {user ? '去购买' : '登录购买'}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 高校模板 */}
      {presetCount > 0 && (
        <section className="border-t border-slate-200 bg-[#F7F5F0]">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700">
                  <BookOpen className="h-3.5 w-3.5" />格式模板
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-ink">内置 {presetCount}+ 高校论文模板</h2>
                <p className="mt-2 max-w-xl text-sm text-slate-500">
                  清华、北大、人大、复旦、上交、浙大、南大、武大、中山等高校学位论文格式预置，一键按学校规范生成 Word，告别手动排版。
                </p>
              </div>
              <Link to={ctaLink} className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-slate-50">
                查看全部模板 <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* 页脚 */}
      <footer className="bg-[#0B1120] text-slate-400">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 md:flex-row">
          <div className="flex items-center gap-2 text-sm">
            <Logo className="h-5 w-5" />
            <span>{site?.footer_text || `© 2026 ${siteName}`}</span>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-6 pb-8 text-center text-xs leading-relaxed text-slate-500">
          免责声明：本平台由 AI 生成的所有内容（文字、文档、图表、公式等）仅供学习与参考，不构成任何学术成果或建议，严禁直接用于论文写作、作业提交、考试、投稿、查重等任何学术场景；因违规使用产生的一切后果由使用者自行承担。
        </div>
      </footer>
    </div>
  );
}

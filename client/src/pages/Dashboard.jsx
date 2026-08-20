import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { PageSkeleton } from '../components/Skeleton.jsx';
import {
  Pen, Globe, Book, FileWord, ArrowRight, Plus, Receipt,
  FileText, Shield, Refresh, Layers, Activity,
} from '../components/Icons.jsx';

const tools = [
  { to: '/app/writing', icon: Pen, title: 'AI 论文写作', desc: '大纲 / 段落 / 摘要 / 全文，支持深度蒸馏升级', color: 'bg-accent-50 text-accent' },
  { to: '/app/proposal', icon: FileWord, title: '开题报告', desc: '填写研究要素，生成开题报告 Word', color: 'bg-violet-50 text-violet-600' },
  { to: '/app/literature-review', icon: Book, title: '文献综述', desc: '主题分类梳理，含文献引用', color: 'bg-indigo-50 text-indigo-600' },
  { to: '/app/task-book', icon: FileText, title: '任务书', desc: '毕业论文任务书，含进度安排', color: 'bg-teal-50 text-teal-600' },
  { to: '/app/defense', icon: FileWord, title: '答辩PPT+演讲稿', desc: 'PPT大纲与配套演讲稿', color: 'bg-pink-50 text-pink-600' },
  { to: '/app/journal', icon: FileText, title: '期刊论文', desc: '符合期刊发表规范的学术论文', color: 'bg-orange-50 text-orange-600' },
  { to: '/app/ai-reduce', icon: Shield, title: '降AI率', desc: '智能改写消除AI痕迹', color: 'bg-emerald-50 text-emerald-600' },
  { to: '/app/rewrite', icon: Refresh, title: '论文降重', desc: '同义改写降低重复率', color: 'bg-cyan-50 text-cyan-600' },
  { to: '/app/polish', icon: Globe, title: '润色与翻译', desc: '学术润色 · 中英互译 · 语法纠错', color: 'bg-lime-50 text-lime-600' },
  { to: '/app/references', icon: Book, title: '文献管理', desc: '检索收藏 · 多格式引用导出', color: 'bg-amber-50 text-amber-600' },
  { to: '/app/projects', icon: Layers, title: '论文工作区', desc: 'AI记忆上下文，跨工具协作', color: 'bg-slate-100 text-slate-600' },
];

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listDocs().then((d) => setDocs(d.docs || [])).catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const fmtTime = (ts) => {
    if (!ts) return '—';
    return new Date(Number(ts) * 1000).toLocaleString('zh-CN');
  };

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      {loading ? (
        <PageSkeleton cards={4} />
      ) : (<>
      {/* 欢迎横幅 */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">你好，{user?.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            按需付费的学术论文辅助平台，先下单支付再使用各项功能
          </p>
        </div>
        <button onClick={() => navigate('/app/orders')} className="btn-primary">
          <Receipt className="h-4 w-4" />
          我的订单
        </button>
      </div>

      {/* 工具入口 */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tools.map((t) => (
          <button
            key={t.to}
            onClick={() => navigate(t.to)}
            className="group card flex flex-col items-start p-6 text-left transition hover:-translate-y-0.5 hover:shadow-card"
          >
            <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${t.color}`}>
              <t.icon className="h-[22px] w-[22px]" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-ink">{t.title}</h3>
            <p className="mt-1 text-sm text-slate-500">{t.desc}</p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent opacity-0 transition group-hover:opacity-100">
              进入工具 <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </button>
        ))}
      </div>

      {/* 计费说明 + 最近文档 */}
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {/* 计费方式卡片 */}
        <div className="card p-6">
          <div className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-accent" />
            <h3 className="text-sm font-semibold text-ink">计费方式</h3>
          </div>
          <div className="mt-4 space-y-3 text-sm text-slate-600">
            <div className="rounded-md bg-accent-50 px-3 py-2.5 text-xs text-accent-700">
              <span className="flex items-center gap-1.5">
                <Receipt className="h-3.5 w-3.5" />固定价格功能：先下单支付，再生成
              </span>
            </div>
            <div className="rounded-md bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
              <span className="flex items-center gap-1.5">
                <Receipt className="h-3.5 w-3.5" />复杂需求支持人工报价，确认后再支付
              </span>
            </div>
            <button onClick={() => navigate('/app/orders')} className="btn-primary mt-2 w-full">
              查看我的订单
            </button>
          </div>
        </div>

        {/* 最近文档 */}
        <div className="card p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">最近生成的文档</h3>
            <div className="flex items-center gap-3">
              <button onClick={() => navigate('/app/docs')} className="text-xs font-medium text-accent hover:underline">全部</button>
              <button
                onClick={() => navigate('/app/writing')}
                className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
              >
                <Plus className="h-3.5 w-3.5" /> 新建
              </button>
            </div>
          </div>
          <div className="mt-4">
            {docs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <FileText className="h-10 w-10 text-slate-300" />
                <p className="mt-3 text-sm text-slate-400">还没有生成文档，使用写作/开题报告后会自动保存</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {docs.slice(0, 5).map((d) => (
                  <li key={d.id} className="flex items-center gap-3 py-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-50 text-accent">
                      <FileWord className="h-[18px] w-[18px]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">{d.title}</div>
                      <div className="text-xs text-slate-400">{fmtTime(d.created_at)}</div>
                    </div>
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Word</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      </>)}
    </div>
  );
}

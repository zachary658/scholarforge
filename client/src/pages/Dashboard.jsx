import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { PageSkeleton } from '../components/Skeleton.jsx';
import { PAPER_STAGES } from '../lib/constants.js';
import {
  Pen, Globe, Book, FileWord, ArrowRight, Plus, Receipt,
  FileText, Shield, Refresh, Layers, Activity, ChevronRight,
} from '../components/Icons.jsx';

const tools = [
  { to: '/app/writing', icon: Pen, title: 'AI 论文写作', desc: '大纲 / 段落 / 摘要 / 全文，支持深度文献调研', color: 'bg-accent-50 text-accent' },
  { to: '/app/proposal', icon: FileWord, title: '开题报告', desc: '填写研究要素，生成开题报告 Word', color: 'bg-violet-50 text-violet-600' },
  { to: '/app/literature-review', icon: Book, title: '文献综述', desc: '主题分类梳理，含文献引用', color: 'bg-indigo-50 text-indigo-600' },
  { to: '/app/task-book', icon: FileText, title: '任务书', desc: '毕业论文任务书，含进度安排', color: 'bg-teal-50 text-teal-600' },
  { to: '/app/defense', icon: FileWord, title: '答辩PPT+演讲稿', desc: 'PPT大纲与配套演讲稿', color: 'bg-pink-50 text-pink-600' },
  { to: '/app/journal', icon: FileText, title: '期刊论文', desc: '符合期刊发表规范的学术论文', color: 'bg-orange-50 text-orange-600' },
  { to: '/app/ai-reduce', icon: Shield, title: '表达自然度优化', desc: '识别并优化机械化表达', color: 'bg-emerald-50 text-emerald-600' },
  { to: '/app/rewrite', icon: Refresh, title: '重复表达优化', desc: '优化重复表达，提升表达多样性', color: 'bg-cyan-50 text-cyan-600' },
  { to: '/app/polish', icon: Globe, title: '润色与翻译', desc: '学术润色 · 中英互译 · 语法纠错', color: 'bg-lime-50 text-lime-600' },
  { to: '/app/references', icon: Book, title: '文献管理', desc: '检索收藏 · 多格式引用导出', color: 'bg-amber-50 text-amber-600' },
  { to: '/app/projects', icon: Layers, title: '论文工作区', desc: 'AI记忆上下文，跨工具协作', color: 'bg-slate-100 text-slate-600' },
  { to: '/app/patent', icon: Shield, title: '专利申请', desc: 'AI 交底书撰写 · 专人对接办理', color: 'bg-violet-50 text-violet-600' },
  { to: '/app/publication', icon: Book, title: '期刊论文发表', desc: 'AI 审稿回复 · 选刊投稿协助', color: 'bg-rose-50 text-rose-600' },
];

function projectProgress(p) {
  if (p.completion_percent > 0) return p.completion_percent;
  const idx = PAPER_STAGES.findIndex((s) => s.key === (p.current_stage || 'create'));
  const i = idx >= 0 ? idx : 0;
  return Math.round(((i + 1) / PAPER_STAGES.length) * 100);
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [docs, setDocs] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.listDocs().then((d) => setDocs(d.docs || [])).catch(() => {}),
      api.listProjects().then((d) => setProjects(d.projects || [])).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const fmtTime = (ts) => {
    if (!ts) return '—';
    return new Date(Number(ts) * 1000).toLocaleString('zh-CN');
  };

  const recentProject = projects[0] || null;
  const recentPercent = recentProject ? projectProgress(recentProject) : 0;

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      {loading ? (
        <PageSkeleton cards={4} />
      ) : (<>
      {/* 欢迎横幅：以「继续论文」为核心，而非先下单 */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">继续完成你的论文项目</h1>
          <p className="mt-1 text-sm text-slate-500">
            资料、写作任务、文献与交付内容都集中在这里
          </p>
        </div>
        <button onClick={() => navigate('/app/projects')} className="btn-primary">
          <Layers className="h-4 w-4" />
          我的论文
        </button>
      </div>

      {/* 继续最近论文 / 新建论文 */}
      {recentProject ? (
        <div className="mt-6 card p-6">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-400">最近论文</span>
                {recentProject.auto_created ? (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">自动归档</span>
                ) : null}
              </div>
              <h2 className="mt-1 truncate text-lg font-semibold text-ink">{recentProject.title}</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {recentProject.field || '未设置学科'} · {recentProject.task_count || 0} 个任务
              </p>
            </div>
            <button
              onClick={() => navigate(`/app/projects`)}
              className="btn-primary flex-shrink-0"
            >
              继续 <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>整体进度</span>
              <span>{recentPercent}%</span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${recentPercent}%` }} />
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-6 card flex items-center justify-between p-6">
          <div>
            <h2 className="text-lg font-semibold text-ink">从创建论文开始</h2>
            <p className="mt-0.5 text-sm text-slate-500">录入专业、题目、学历与截止时间，按流程逐步完成论文</p>
          </div>
          <button onClick={() => navigate('/app/projects')} className="btn-primary">
            <Plus className="h-4 w-4" /> 创建论文
          </button>
        </div>
      )}

      {/* 工具入口 */}
      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-slate-500">常用工具</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
      </div>

      {/* 订单入口 + 最近文档 */}
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {/* 订单入口 */}
        <div className="card p-6">
          <div className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-accent" />
            <h3 className="text-sm font-semibold text-ink">订单与交付</h3>
          </div>
          <div className="mt-4 space-y-3 text-sm text-slate-600">
            <button onClick={() => navigate('/app/orders')} className="btn-primary w-full">
              <Receipt className="h-4 w-4" /> 我的订单
            </button>
            <button onClick={() => navigate('/app/tasks')} className="btn-ghost w-full">
              <Activity className="h-4 w-4" /> 任务进度
            </button>
            <button onClick={() => navigate('/app/docs')} className="btn-ghost w-full">
              <FileWord className="h-4 w-4" /> 我的文档
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

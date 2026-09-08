import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { toast } from '../components/Toast.jsx';
import { ArrowRight, BookOpen, Cpu, Refresh } from '../components/Icons.jsx';

const LABELS = {
  submitted: '已提交', evaluating: '评估中', awaiting_quote: '待报价', awaiting_payment: '待付款',
  paid: '已付款', in_progress: '进行中', waiting_customer: '待你补充', pending_acceptance: '待验收',
  revision: '修改中', completed: '已完成', cancelled: '已取消', refunded: '已退款',
};

export default function ServiceProjects() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    try { setProjects((await api.listServiceProjects()).projects || []); }
    catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div><h1 className="text-xl font-bold text-ink">服务进度与交付</h1><p className="mt-1 text-sm text-slate-500">统一查看一对一指导和毕业作品的进度、补充要求、验收及成果文件。</p></div>
        <button className="btn-ghost text-xs" onClick={load}><Refresh className="h-4 w-4" />刷新</button>
      </div>
      <div className="mt-6 space-y-4">
        {loading ? <div className="card p-10 text-center text-slate-400">加载中…</div> : projects.length === 0 ? (
          <div className="card p-10 text-center"><p className="text-sm text-slate-500">还没有人工服务项目</p><div className="mt-4 flex justify-center gap-3"><button className="btn-secondary" onClick={() => navigate('/app/courses')}>论文一对一指导</button><button className="btn-primary" onClick={() => navigate('/app/graduation')}>毕业作品指导</button></div></div>
        ) : projects.map((p) => {
          const Icon = p.service_type === 'thesis_coaching' ? BookOpen : Cpu;
          return <button key={p.id} onClick={() => navigate(`/app/service-projects/${p.id}`)} className="card block w-full p-5 text-left transition hover:border-accent/30 hover:shadow-sm">
            <div className="flex items-start gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent"><Icon className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-ink">{p.service_type === 'thesis_coaching' ? '论文一对一指导' : '毕业作品指导'}</span><span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{LABELS[p.status] || p.status}</span><span className="font-mono text-xs text-slate-400">{p.project_no}</span></div><p className="mt-1 text-sm text-slate-500">{p.stage} · {p.next_action}</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-accent" style={{ width: `${p.progress}%` }} /></div><div className="mt-1 text-right text-xs text-slate-400">{p.progress}%</div></div><ArrowRight className="mt-2 h-5 w-5 text-slate-400" /></div>
          </button>;
        })}
      </div>
    </div>
  );
}

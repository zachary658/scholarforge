import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { toast } from '../components/Toast.jsx';
import { Check, ChevronLeft, Download, FileText, Refresh } from '../components/Icons.jsx';

const LABELS = { submitted:'已提交', evaluating:'评估中', awaiting_quote:'待报价', awaiting_payment:'待付款', paid:'已付款', in_progress:'进行中', waiting_customer:'待你补充', pending_acceptance:'待验收', revision:'修改中', completed:'已完成', cancelled:'已取消', refunded:'已退款' };
const fmt = (ts) => ts ? new Date(Number(ts) * 1000).toLocaleString('zh-CN') : '—';

export default function ServiceProjectDetail() {
  const { id } = useParams(); const navigate = useNavigate(); const fileRef = useRef(null);
  const [project, setProject] = useState(null); const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const load = async () => { try { setProject((await api.serviceProjectDetail(id)).project); } catch (err) { toast.error(err.message); } };
  useEffect(() => { load(); }, [id]);
  const submit = async (kind) => {
    if (kind !== 'acceptance' && !text.trim()) return toast.warning('请先填写内容');
    setBusy(true); try { const data = await api.submitServiceProjectAction(id, { kind, content: text, idempotency_key: crypto.randomUUID() }); setProject(data.project); setText(''); toast.success(kind === 'acceptance' ? '已确认验收' : '已提交'); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const upload = async (file) => { if (!file) return; setBusy(true); try { await api.uploadServiceAttachment(id, file); await load(); toast.success('附件已上传'); } catch (err) { toast.error(err.message); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; } };
  if (!project) return <div className="p-10 text-center text-slate-400">加载中…</div>;
  return <div className="mx-auto max-w-5xl px-8 py-8">
    <button className="btn-ghost text-xs" onClick={() => navigate('/app/service-projects')}><ChevronLeft className="h-4 w-4" />返回服务项目</button>
    <div className="mt-4 card p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h1 className="text-xl font-bold text-ink">{project.service_type === 'thesis_coaching' ? '论文一对一指导' : '毕业作品指导'}</h1><span className="rounded bg-accent-50 px-2 py-1 text-xs text-accent">{LABELS[project.status] || project.status}</span></div><p className="mt-1 font-mono text-xs text-slate-400">项目号 {project.project_no}</p></div><button className="btn-ghost text-xs" onClick={load}><Refresh className="h-4 w-4" />刷新</button></div>
      <div className="mt-5 rounded-xl bg-slate-50 p-4"><div className="flex justify-between text-sm"><span className="font-medium text-ink">{project.stage}</span><span className="text-accent">{project.progress}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white"><div className="h-full bg-accent" style={{width:`${project.progress}%`}} /></div><p className="mt-3 text-sm text-slate-600"><b>下一步：</b>{project.next_action}</p>{project.user_visible_note && <p className="mt-1 text-sm text-slate-500">{project.user_visible_note}</p>}</div>
    </div>
    <div className="mt-6 grid gap-6 lg:grid-cols-2"><section className="card p-6"><h2 className="font-semibold text-ink">进度记录</h2><div className="mt-4 space-y-4">{project.updates.map(u => <div key={u.id} className="border-l-2 border-accent-100 pl-4"><div className="text-sm font-medium text-ink">{u.stage} · {u.progress}%</div><div className="text-xs text-slate-400">{fmt(u.created_at)}</div>{u.user_visible_note && <p className="mt-1 text-sm text-slate-500">{u.user_visible_note}</p>}</div>)}</div></section>
      <section className="space-y-6"><div className="card p-6"><h2 className="font-semibold text-ink">成果与附件</h2><div className="mt-3 space-y-2">{project.attachments.length === 0 ? <p className="text-sm text-slate-400">暂无附件</p> : project.attachments.map(a => <button key={a.id} onClick={() => api.downloadServiceAttachment(id, a.id, a.original_name).catch(e => toast.error(e.message))} className="flex w-full items-center gap-3 rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50"><FileText className="h-4 w-4 text-accent" /><span className="min-w-0 flex-1 truncate text-sm">{a.original_name}</span><span className="text-xs text-slate-400">{a.role === 'deliverable' ? '交付成果' : '补充材料'}</span><Download className="h-4 w-4" /></button>)}</div><input ref={fileRef} type="file" className="mt-4 block w-full text-sm" disabled={busy} onChange={e => upload(e.target.files?.[0])} /><p className="mt-1 text-xs text-slate-400">单文件不超过20MB，每个项目最多30个/200MB。</p></div>
      <div className="card p-6"><h2 className="font-semibold text-ink">补充与验收</h2><textarea className="input mt-3" rows={4} value={text} onChange={e => setText(e.target.value)} placeholder={project.status === 'pending_acceptance' ? '如需修改，请具体说明修改位置和要求' : '补充新的要求或资料说明'} /><div className="mt-3 flex flex-wrap gap-2"><button className="btn-secondary" disabled={busy} onClick={() => submit('supplement')}>提交补充</button>{project.status === 'pending_acceptance' && <><button className="btn-secondary" disabled={busy} onClick={() => submit('revision_request')}>申请修改</button><button className="btn-primary" disabled={busy} onClick={() => submit('acceptance')}><Check className="h-4 w-4" />确认验收</button></>}</div></div></section></div>
  </div>;
}

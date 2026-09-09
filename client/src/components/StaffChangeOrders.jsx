import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { toast } from './Toast.jsx';
import FormalQuoteModal from './FormalQuoteModal.jsx';

const LABELS = { pending:'待评估', needs_info:'待补充', awaiting_customer:'待用户确认', payment_pending:'待付款', in_progress:'处理中', completed:'已完成', rejected:'已拒绝', withdrawn:'已撤回' };

export default function StaffChangeOrders({ scope, readOnly = false }) {
  const [items, setItems] = useState([]); const [selected, setSelected] = useState(null); const [busy, setBusy] = useState(false);
  const load = () => api.staffListServiceChanges(scope).then((data) => setItems(data.items || [])).catch((error) => toast.error(error.message));
  useEffect(() => { load(); }, []);
  const assess = async (payload) => {
    const included = !!selected?._included; setBusy(true);
    try {
      await api.supportAssessServiceChange(selected.id, { action:'quote', assessment_type:included ? 'included' : 'chargeable', change_scope:payload.quote_scope, quote_exclusions:payload.quote_exclusions, discipline_category:payload.discipline_category, estimated_hours:payload.estimated_hours, quoted_price:payload.quoted_price });
      toast.success(included ? '已发送套餐内变更确认' : '收费变更报价已发送给用户'); setSelected(null); load();
    } catch (error) { toast.error(error.message); } finally { setBusy(false); }
  };
  const complete = async (id) => { try { await api.supportCompleteServiceChange(id); toast.success('变更已完成'); load(); } catch (error) { toast.error(error.message); } };
  return <div className="mx-auto max-w-6xl px-6 py-8"><h1 className="text-xl font-bold text-ink">需求变更单</h1><p className="mt-1 text-sm text-slate-500">{readOnly ? '查看全部变更、补款与处理记录；管理员不可代替客服操作。' : '先判断套餐内或收费变更，再把明确范围发送给用户确认。'}</p>
    <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-3">变更单</th><th className="p-3">用户/原订单</th><th className="p-3">需求</th><th className="p-3">状态</th><th className="p-3">补款</th><th className="p-3">操作</th></tr></thead><tbody>{items.map((change) => <tr className="border-t" key={change.id}><td className="p-3 font-mono text-xs">{change.change_no}</td><td className="p-3">{change.user_name}<div className="text-xs text-slate-400">{change.source_order_no}</div></td><td className="max-w-xs p-3 text-xs text-slate-600">{change.request_summary}</td><td className="p-3">{LABELS[change.status] || change.status}</td><td className="p-3">{change.amount_cents ? `¥${(change.amount_cents / 100).toFixed(2)}` : '—'}</td><td className="p-3">{readOnly ? <span className="text-xs text-slate-400">仅查看</span> : ['pending','needs_info','awaiting_customer'].includes(change.status) && <div className="flex gap-2"><button className="btn-secondary px-2 py-1 text-xs" onClick={() => setSelected({ ...change, _included:true })}>套餐内</button><button className="btn-primary px-2 py-1 text-xs" onClick={() => setSelected(change)}>需补款</button></div>}{!readOnly && change.status === 'in_progress' && <button className="btn-primary px-2 py-1 text-xs" onClick={() => complete(change.id)}>完成</button>}</td></tr>)}</tbody></table>{!items.length && <div className="p-10 text-center text-sm text-slate-400">暂无变更单</div>}</div>
    <FormalQuoteModal open={!!selected} included={!!selected?._included} busy={busy} onClose={() => setSelected(null)} onSubmit={assess} />
  </div>;
}

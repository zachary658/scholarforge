import { useEffect, useState } from 'react';

const EMPTY = { quoted_price: '', discipline_category: 'humanities', estimated_hours: '', quote_scope: '', quote_exclusions: '' };

export default function FormalQuoteModal({ open, initial, busy, onClose, onSubmit, included = false }) {
  const [form, setForm] = useState(EMPTY);
  useEffect(() => { if (open) setForm({ ...EMPTY, ...(initial || {}) }); }, [open, initial]);
  if (!open) return null;
  const submit = () => onSubmit({ ...form, quoted_price: Number(form.quoted_price), estimated_hours: Number(form.estimated_hours) });
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
      <h3 className="text-lg font-semibold text-ink">{included ? '确认套餐内变更范围' : '发送正式报价'}</h3>
      <p className="mt-1 text-sm text-slate-500">{included ? '明确本次免费包含的工作，用户确认后直接进入处理。' : '客服确认后直接发送给用户。用户确认并完成付款后才进入履约。'}</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {!included && <><label className="text-sm">学科类别<select className="input mt-1" value={form.discipline_category} onChange={(event) => setForm({ ...form, discipline_category: event.target.value })}><option value="humanities">人文社科</option><option value="stem">理工科</option></select></label>
        <label className="text-sm">预计人工工时<input className="input mt-1" type="number" min="0.5" step="0.5" value={form.estimated_hours} onChange={(event) => setForm({ ...form, estimated_hours: event.target.value })} placeholder="例如 10" /></label>
        <label className="text-sm sm:col-span-2">报价金额（元）<input className="input mt-1" type="number" min="0.01" step="0.01" value={form.quoted_price} onChange={(event) => setForm({ ...form, quoted_price: event.target.value })} placeholder="系统会按学科成本和工时校验最低报价" /></label></>}
        <label className="text-sm sm:col-span-2">本次包含内容与交付物<textarea className="input mt-1" rows="4" maxLength="3000" value={form.quote_scope} onChange={(event) => setForm({ ...form, quote_scope: event.target.value })} placeholder="明确写出工作范围、交付文件、修改次数和预计周期" /></label>
        <label className="text-sm sm:col-span-2">不包含事项（选填）<textarea className="input mt-1" rows="2" maxLength="2000" value={form.quote_exclusions} onChange={(event) => setForm({ ...form, quote_exclusions: event.target.value })} placeholder="例如：第三方检测费、超出约定次数的重做等" /></label>
      </div>
      {!included && <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">报价低于管理员配置的利润保护线时，服务端会拒绝发送；内部成本不会展示给用户。</div>}
      <div className="mt-5 flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>取消</button><button className="btn-primary" disabled={busy || (!included && (!form.quoted_price || !form.estimated_hours)) || !form.quote_scope.trim()} onClick={submit}>{busy ? '发送中…' : '确认并发送给用户'}</button></div>
    </div>
  </div>;
}

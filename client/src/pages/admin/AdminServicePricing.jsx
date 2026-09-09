import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { toast } from '../../components/Toast.jsx';
import { Check, Wallet } from '../../components/Icons.jsx';

const DEFAULTS = { service_labor_cost_stem: '80', service_labor_cost_humanities: '50', service_min_profit_markup: '5' };

export default function AdminServicePricing() {
  const [form, setForm] = useState(DEFAULTS);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.adminGetSettings().then(({ settings }) => setForm({ ...DEFAULTS, ...Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, settings[key] ?? DEFAULTS[key]])) })).catch((error) => toast.error(error.message)); }, []);
  const preview = useMemo(() => {
    const markup = 1 + Number(form.service_min_profit_markup || 0);
    return {
      stem: Number(form.service_labor_cost_stem || 0) * 10 * markup,
      humanities: Number(form.service_labor_cost_humanities || 0) * 10 * markup,
    };
  }, [form]);
  const save = async () => {
    setBusy(true);
    try { await api.adminUpdateSettings(form); toast.success('人工服务成本策略已保存'); }
    catch (error) { toast.error(error.message); }
    finally { setBusy(false); }
  };
  const field = (key, label, help) => <label className="block text-sm font-medium text-slate-700">{label}<input className="input mt-1" type="number" min={key === 'service_min_profit_markup' ? 5 : 0.01} step="0.01" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /><span className="mt-1 block text-xs font-normal text-slate-400">{help}</span></label>;
  return <div className="mx-auto max-w-5xl px-6 py-8">
    <div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700"><Wallet className="h-5 w-5" /></div><div><h1 className="text-xl font-bold text-ink">人工服务定价</h1><p className="mt-1 text-sm text-slate-500">这里只配置内部成本和报价保护线；客服负责评估与向用户发出正式报价。</p></div></div>
    <div className="mt-6 grid gap-5 rounded-2xl border border-slate-200 bg-white p-6 md:grid-cols-3">
      {field('service_labor_cost_stem', '理工科人工成本（元/小时）', '适用于工科、理科、计算机、实验与工程设计类服务。')}
      {field('service_labor_cost_humanities', '人文社科人工成本（元/小时）', '适用于文学、法学、教育、管理及其他人文社科服务。')}
      {field('service_min_profit_markup', '最低利润/成本倍数', '最低为 5，即利润不低于成本的 500%，对应售价不低于成本的 6 倍。')}
    </div>
    <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 p-5"><div className="text-sm font-semibold text-blue-900">10 小时项目报价底线预览</div><div className="mt-3 grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-white/80 p-4 text-sm text-slate-600">理工科最低报价<div className="mt-1 text-xl font-bold text-ink">¥{Number.isFinite(preview.stem) ? preview.stem.toFixed(2) : '—'}</div></div><div className="rounded-xl bg-white/80 p-4 text-sm text-slate-600">人文社科最低报价<div className="mt-1 text-xl font-bold text-ink">¥{Number.isFinite(preview.humanities) ? preview.humanities.toFixed(2) : '—'}</div></div></div><p className="mt-3 text-xs text-blue-700">该底线仅供内部报价校验，不会向用户展示人工成本或利润结构。</p></div>
    <div className="mt-6 flex justify-end"><button className="btn-primary" disabled={busy} onClick={save}><Check className="h-4 w-4" />{busy ? '保存中…' : '保存成本策略'}</button></div>
  </div>;
}

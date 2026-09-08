import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { toast } from '../../components/Toast.jsx';
import { Refresh } from '../../components/Icons.jsx';

export default function AdminPromotion() {
  const [data, setData] = useState({ partners: [], codes: [] });
  const [partner, setPartner] = useState('');
  const [code, setCode] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [adminPassword, setAdminPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');

  const load = async () => {
    try { setData(await api.adminPromotion()); } catch (err) { toast.error(err.message); }
  };
  useEffect(() => { load(); }, []);
  const addPartner = async () => {
    try { await api.adminCreatePromotionPartner({ name: partner }); setPartner(''); await load(); toast.success('推广方已创建'); }
    catch (err) { toast.error(err.message); }
  };
  const addCode = async () => {
    try { await api.adminCreatePromotionCode({ code, partner_id: Number(partnerId) }); setCode(''); await load(); toast.success('推广码已创建'); }
    catch (err) { toast.error(err.message); }
  };
  const togglePartner = async (item) => {
    try { await api.adminSetPromotionPartner(item.id, !item.is_active); await load(); toast.success(item.is_active ? '推广方已停用' : '推广方已启用'); }
    catch (err) { toast.error(err.message); }
  };
  const toggleCode = async (item) => {
    try { await api.adminSetPromotionCode(item.id, !item.is_active); await load(); toast.success(item.is_active ? '推广码已停用' : '推广码已启用'); }
    catch (err) { toast.error(err.message); }
  };
  const openDelete = (type, item) => {
    setDeleting({ type, item, expected: `DELETE ${type === 'partner' ? 'PARTNER' : 'CODE'} ${item.id}` });
    setAdminPassword(''); setConfirmation('');
  };
  const confirmDelete = async () => {
    try {
      const payload = { admin_password: adminPassword, confirmation };
      if (deleting.type === 'partner') await api.adminDeletePromotionPartner(deleting.item.id, payload);
      else await api.adminDeletePromotionCode(deleting.item.id, payload);
      setDeleting(null); await load(); toast.success('已删除未被业务引用的记录');
    } catch (err) { toast.error(err.message); }
  };

  return <div className="mx-auto max-w-6xl px-6 py-8">
    <div className="flex justify-between"><div><h1 className="text-xl font-bold text-ink">推广渠道</h1><p className="mt-1 text-sm text-slate-500">停用会立即阻止新归因；已产生业务引用的数据只允许停用，不允许删除。</p></div><button className="btn-ghost" onClick={load}><Refresh className="h-4 w-4" />刷新</button></div>
    <div className="mt-6 grid gap-4 md:grid-cols-2">
      <div className="card p-5"><h2 className="font-semibold">新增推广方</h2><div className="mt-3 flex gap-2"><input className="input" value={partner} onChange={(e) => setPartner(e.target.value)} placeholder="推广方名称" /><button className="btn-primary" onClick={addPartner}>添加</button></div></div>
      <div className="card p-5"><h2 className="font-semibold">新增推广码</h2><div className="mt-3 flex gap-2"><input className="input uppercase" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="推广码" /><select className="input" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}><option value="">选择推广方</option>{data.partners.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="btn-primary" onClick={addCode}>添加</button></div></div>
    </div>
    <div className="mt-6 overflow-x-auto rounded-xl border bg-white"><div className="border-b px-4 py-3 font-semibold">推广方</div><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-3">名称</th><th className="p-3">推广码</th><th className="p-3">项目</th><th className="p-3">成交金额</th><th className="p-3">状态与操作</th></tr></thead><tbody>{data.partners.map((p) => <tr key={p.id} className="border-t"><td className="p-3">{p.name}</td><td className="p-3">{p.code_count}</td><td className="p-3">{p.project_count}</td><td className="p-3">¥{Number(p.paid_amount || 0).toFixed(2)}</td><td className="p-3"><span className={p.is_active ? 'text-green-700' : 'text-slate-400'}>{p.is_active ? '启用' : '停用'}</span><button className="btn-ghost ml-2 text-xs" onClick={() => togglePartner(p)}>{p.is_active ? '停用' : '启用'}</button><button className="ml-2 text-xs text-red-600" onClick={() => openDelete('partner', p)}>删除</button></td></tr>)}</tbody></table>{!data.partners.length && <div className="p-8 text-center text-sm text-slate-400">暂无推广方</div>}</div>
    <div className="mt-6 overflow-x-auto rounded-xl border bg-white"><div className="border-b px-4 py-3 font-semibold">推广码</div><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-3">推广码</th><th className="p-3">推广方</th><th className="p-3">项目数</th><th className="p-3">成交数</th><th className="p-3">成交金额</th><th className="p-3">状态与操作</th></tr></thead><tbody>{data.codes.map((c) => <tr key={c.id} className="border-t"><td className="p-3 font-mono">{c.code}</td><td className="p-3">{c.partner_name}</td><td className="p-3">{c.project_count}</td><td className="p-3">{c.paid_count}</td><td className="p-3">¥{Number(c.paid_amount || 0).toFixed(2)}</td><td className="p-3">{!c.partner_active && <span className="mr-2 text-xs text-amber-600">推广方已停用</span>}<button className="btn-ghost text-xs" onClick={() => toggleCode(c)}>{c.is_active ? '停用' : '启用'}</button><button className="ml-2 text-xs text-red-600" onClick={() => openDelete('code', c)}>删除</button></td></tr>)}</tbody></table>{!data.codes.length && <div className="p-8 text-center text-sm text-slate-400">暂无推广码</div>}</div>
    {deleting && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"><h2 className="font-semibold">确认删除</h2><p className="mt-2 text-sm text-slate-600">仅允许删除没有业务引用的数据。请输入管理员密码和确认短语：</p><code className="mt-2 block rounded bg-slate-100 p-2 text-sm">{deleting.expected}</code><input type="password" className="input mt-4 w-full" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="管理员密码" /><input className="input mt-3 w-full" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder={deleting.expected} /><div className="mt-5 flex justify-end gap-2"><button className="btn-secondary" onClick={() => setDeleting(null)}>取消</button><button className="btn-primary bg-red-600" disabled={!adminPassword || confirmation !== deleting.expected} onClick={confirmDelete}>永久删除</button></div></div></div>}
  </div>;
}

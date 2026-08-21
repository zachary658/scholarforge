import { useEffect, useState } from 'react';
import { api, downloadDocFile } from '../lib/api.js';
import { useTool } from '../lib/useTool.js';
import FeaturePay from '../components/FeaturePay.jsx';
import PayModal from '../components/PayModal.jsx';
import {
  Sparkle, Copy, Download, Refresh, Check, FileWord, BadgeCheck, Shield,
} from '../components/Icons.jsx';
import { toast } from '../components/Toast.jsx';

const TYPE_LABEL = { invention: '发明专利', utility: '实用新型', design: '外观设计' };
const STATUS_LABEL = { pending: '待对接', contacted: '已对接', paid: '已支付', completed: '已完成' };
const QUOTE_LABEL = { none: '待报价', pending: '报价待审批', approved: '报价已通过', rejected: '报价已驳回' };

// 专利申请：服务需求提交 + AI 专利交底书撰写 + 我的服务订单
export default function Patent() {
  const tool = useTool(); // AI 专利交底书工具
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState({ patent_type: 'invention', title: '', tech_description: '', contact: '' });
  const [submitting, setSubmitting] = useState(false);
  const [orders, setOrders] = useState([]);
  const [tab, setTab] = useState('ai'); // ai=交底书工具 / service=申请服务 / my=我的订单
  const [payState, setPayState] = useState(null); // 服务订单支付
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.getPatentTypes().then((d) => setTypes(d.patent_types || [])).catch(() => {});
    loadOrders();
  }, []);

  const loadOrders = async () => {
    try {
      const d = await api.myPatentOrders();
      setOrders(d.orders || []);
    } catch { /* 忽略 */ }
  };

  const run = (orderNo) => {
    if (!form.title.trim()) { tool.setError('请填写发明名称'); return; }
    tool.run(() => api.patentDraft({
      title: form.title.trim(),
      tech_description: form.tech_description,
      orderNo: orderNo || undefined,
    }));
  };

  const submitService = async () => {
    if (!form.title.trim()) { toast.error('请填写发明名称'); return; }
    if (!form.tech_description.trim()) { toast.error('请填写技术方案描述'); return; }
    setSubmitting(true);
    try {
      await api.createPatentOrder({
        patent_type: form.patent_type,
        title: form.title.trim(),
        tech_description: form.tech_description,
        contact: form.contact,
      });
      toast.success('需求已提交，客服将尽快与您对接报价');
      setForm({ ...form, tech_description: '', contact: '' });
      loadOrders();
      setTab('my');
    } catch (err) {
      toast.error(err.message || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePay = async (order) => {
    try {
      const data = await api.payPatentOrder(order.id);
      setPayState({ ...data, svcOrder: order });
    } catch (err) {
      toast.error(err.message || '发起支付失败');
    }
  };

  const handleCopy = async () => {
    if (!tool.result?.content) return;
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(tool.result.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* 忽略 */ }
  };

  const result = tool.result;
  const docInfo = result?.doc || null;

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col px-8 py-8">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-xl font-bold text-ink">
          <Shield className="h-5 w-5 text-accent" /> 专利申请
        </h1>
        <p className="mt-1 text-sm text-slate-500">AI 撰写专利技术交底书 · 提交申请需求由专业人员对接办理</p>
      </div>

      {/* 标签切换 */}
      <div className="mb-5 flex gap-1 border-b border-slate-200">
        {[
          { key: 'ai', label: 'AI 交底书撰写' },
          { key: 'service', label: '提交申请需求' },
          { key: 'my', label: `我的申请 (${orders.length})` },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-t-lg px-4 py-2.5 text-sm font-medium transition ${
              tab === t.key ? 'border-b-2 border-accent text-accent' : 'text-slate-500 hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'ai' && (
        <div className="grid flex-1 gap-6 lg:grid-cols-[340px_1fr]">
          <div className="card flex flex-col p-6">
            <div className="space-y-4">
              <div>
                <label className="label">发明名称</label>
                <input className="input" placeholder="如：一种基于深度学习的图像分割方法" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div>
                <label className="label">技术方案描述</label>
                <textarea
                  className="input min-h-[180px] resize-none"
                  placeholder="描述你的技术方案：解决的问题、技术思路、关键步骤、创新点…"
                  value={form.tech_description}
                  onChange={(e) => setForm({ ...form, tech_description: e.target.value })}
                />
              </div>
            </div>
            <div className="mt-5 flex-1" />
            <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">本功能为付费功能，先下单支付后生成（专利技术交底书）</div>
            <button onClick={() => run()} disabled={tool.loading} className="btn-primary w-full py-3">
              {tool.loading ? <><Refresh className="h-4 w-4 animate-spin" /> 撰写中…</> : <><Sparkle className="h-4 w-4" /> 生成交底书</>}
            </button>
            {tool.error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{tool.error}</div>}
          </div>

          <div className="card flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <span className="text-sm font-medium text-slate-600">交底书结果</span>
              {result && (
                <div className="flex items-center gap-1">
                  {result.content && (
                    <button onClick={handleCopy} className="btn-ghost text-xs">
                      {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />} {copied ? '已复制' : '复制'}
                    </button>
                  )}
                  {docInfo && (
                    <button onClick={() => downloadDocFile(docInfo.id, form.title || '专利交底书')} className="btn-ghost text-xs text-accent">
                      <Download className="h-4 w-4" /> 下载 Word
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {result ? (
                <div>
                  {result.chargeType === 'paid' && (
                    <div className="mb-3 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                      <span className="rounded bg-accent-50 px-1.5 py-0.5 font-medium text-accent">已付费 ¥{Number(result.amount || 0).toFixed(2)}</span>
                      {docInfo && <span className="ml-auto flex items-center gap-1"><FileWord className="h-3.5 w-3.5" /> Word 已生成</span>}
                    </div>
                  )}
                  <pre className="whitespace-pre-wrap font-serif text-[14px] leading-[1.85] text-slate-700">{result.content}</pre>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-50 text-accent"><Sparkle className="h-7 w-7" /></div>
                  <p className="mt-4 text-sm font-medium text-slate-600">填写发明名称与技术方案后点击「生成交底书」</p>
                  <p className="mt-1 text-xs text-slate-400">交底书按专利代理规范生成，含技术领域/背景/发明内容/实施方式</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'service' && (
        <div className="card max-w-3xl p-6">
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            {(types.length > 0 ? types : [
              { key: 'invention', label: '发明专利', desc: '产品、方法的新技术方案' },
              { key: 'utility', label: '实用新型', desc: '产品的形状、构造新技术方案' },
              { key: 'design', label: '外观设计', desc: '产品的形状、图案、色彩设计' },
            ]).map((t) => (
              <button
                key={t.key}
                onClick={() => setForm({ ...form, patent_type: t.key })}
                className={`rounded-lg border px-3 py-2.5 text-left transition ${
                  form.patent_type === t.key ? 'border-accent bg-accent-50' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="text-sm font-medium text-ink">{t.label}</div>
                <div className="mt-0.5 text-xs text-slate-500">{t.desc}</div>
              </button>
            ))}
          </div>
          <div className="space-y-4">
            <div>
              <label className="label">发明/设计名称</label>
              <input className="input" placeholder="请填写名称" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <label className="label">技术方案描述（必填）</label>
              <textarea className="input min-h-[140px] resize-none" placeholder="详细描述你的技术方案…" value={form.tech_description} onChange={(e) => setForm({ ...form, tech_description: e.target.value })} />
            </div>
            <div>
              <label className="label">联系方式（微信/手机，便于客服对接）</label>
              <input className="input" placeholder="选填" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
            </div>
            <button onClick={submitService} disabled={submitting} className="btn-primary w-full py-3">
              {submitting ? '提交中…' : '提交申请需求'}
            </button>
            <p className="text-center text-xs text-slate-400">提交后客服将与您对接并报价，管理员审批通过后即可在线支付</p>
          </div>
        </div>
      )}

      {tab === 'my' && (
        <div className="space-y-3">
          {orders.length === 0 ? (
            <div className="card p-10 text-center text-sm text-slate-400">暂无申请订单，前往「提交申请需求」开始</div>
          ) : orders.map((o) => (
            <div key={o.id} className="card flex flex-wrap items-center gap-4 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium text-ink">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">{TYPE_LABEL[o.patent_type] || o.patent_type}</span>
                  {o.title}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  状态：{STATUS_LABEL[o.status] || o.status} · {QUOTE_LABEL[o.quote_status] || o.quote_status}
                  {o.quoted_price != null && <span className="ml-2 font-medium text-accent">报价 ¥{Number(o.quoted_price).toFixed(2)}</span>}
                  {o.amount != null && <span className="ml-2">已支付 ¥{Number(o.amount).toFixed(2)}</span>}
                </div>
              </div>
              {o.status === 'pending' && o.quote_status === 'approved' && (
                <button onClick={() => handlePay(o)} className="btn-primary px-4 py-2 text-xs">去支付 ¥{Number(o.quoted_price).toFixed(2)}</button>
              )}
              {o.status === 'pending' && o.quote_status === 'none' && (
                <span className="text-xs text-slate-400">等待客服报价</span>
              )}
              {o.status === 'pending' && o.quote_status === 'pending' && (
                <span className="text-xs text-amber-600">报价待管理员审批</span>
              )}
              {o.status === 'paid' && (
                <span className="flex items-center gap-1 text-xs text-emerald-600"><BadgeCheck className="h-3.5 w-3.5" /> 已支付，服务进行中</span>
              )}
            </div>
          ))}
        </div>
      )}

      {tool.needOrder && (
        <FeaturePay needOrder={tool.needOrder} onPaid={(orderNo) => run(orderNo)} onClose={() => tool.cancelOrder()} />
      )}

      {payState && (
        <PayModal
          order={payState.order}
          payParams={payState.payParams}
          onClose={() => setPayState(null)}
          onPaid={() => { setPayState(null); toast.success('支付成功，服务人员将尽快与您对接'); loadOrders(); }}
        />
      )}
    </div>
  );
}

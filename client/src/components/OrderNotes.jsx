import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { toast } from './Toast.jsx';
import { Refresh, Check } from './Icons.jsx';

function fmtDateTime(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts) * 1000);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN');
}

// 跟进备注（沟通时间线）：客服/管理员可给订单追加备注，记录每一次跟进动作
export default function OrderNotes({ orderType, orderRefId }) {
  const [notes, setNotes] = useState([]);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.supportListNotes(orderType, orderRefId);
      setNotes(data.notes || []);
    } catch {
      setNotes([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [orderType, orderRefId]);

  const add = async () => {
    const text = content.trim();
    if (!text) {
      toast.warning('请输入备注内容');
      return;
    }
    setSubmitting(true);
    try {
      await api.supportAddNote(orderType, orderRefId, text);
      setContent('');
      toast.success('备注已添加');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-500">跟进备注</div>
        <button onClick={load} className="btn-ghost p-1 text-xs" title="刷新">
          <Refresh className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="mt-2 flex gap-2">
        <input
          className="input flex-1 py-2 text-sm"
          placeholder="记录跟进：已加微信 / 已报价 / 用户考虑中…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
        />
        <button onClick={add} disabled={submitting} className="btn-primary shrink-0 px-3 py-2 text-sm">
          {submitting ? <Refresh className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </button>
      </div>

      <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
        {notes.length === 0 ? (
          <div className="rounded-md bg-slate-50 px-3 py-4 text-center text-xs text-slate-400">暂无备注</div>
        ) : (
          notes.map((n) => (
            <div key={n.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-600">{n.author_name || '客服'}</span>
                <span className="text-slate-400">{fmtDateTime(n.created_at)}</span>
              </div>
              <div className="mt-1 whitespace-pre-wrap text-sm text-ink">{n.content}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

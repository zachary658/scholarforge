import { useState } from 'react';
import { api } from '../lib/api.js';
import { Shield, Refresh, X } from './Icons.jsx';

// 学术诚信承诺书弹窗（阶段四 4.1）
// 首次使用「全文生成 / 降AI率 / 降重」等敏感功能前强制勾选同意
export default function AcademicIntegrityModal({ onAgreed, onCancel }) {
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const confirm = async () => {
    if (!checked) return;
    setSaving(true);
    setError('');
    try {
      await api.agreeAcademicIntegrity();
      onAgreed();
    } catch (err) {
      setError(err.message || '提交失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-[640px] max-w-full flex-col rounded-xl bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-accent" />
            <h3 className="text-base font-semibold text-ink">学术诚信承诺书</h3>
          </div>
          <button onClick={onCancel} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 text-sm leading-relaxed text-slate-600">
          <p className="font-medium text-ink">为维护学术诚信，使用平台以下功能前，请您阅读并同意本承诺书。</p>
          <div className="mt-3 space-y-2 text-[13px]">
            <p>1. 本平台提供的「全文生成」「降AI率」「降重」等 AI 写作辅助内容，均由人工智能模型生成，<strong>仅供学习、研究参考，不得直接作为学术成果提交</strong>。</p>
            <p>2. 用户应遵守《中华人民共和国学位法》及所在学校、期刊的学术规范，对最终提交成果的真实性、原创性负责。</p>
            <p>3. AI 生成内容可能存在事实性错误、引用偏差或表述局限，用户需自行核验、修改与完善。</p>
            <p>4. 生成文档中的参考文献、数据与图表仅供示意，请务必核实其真实性与来源后再使用。</p>
            <p>5. 因用户违反学术规范或相关法律法规产生的后果，由用户自行承担，平台不承担相应责任。</p>
          </div>
        </div>

        <div className="border-t border-slate-100 px-6 py-4">
          <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent"
            />
            <span>我已阅读并同意《学术诚信承诺书》，承诺遵守学术规范，不将生成内容直接用于学术提交。</span>
          </label>
          {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={onCancel} className="btn-ghost">暂不</button>
            <button onClick={confirm} disabled={!checked || saving} className="btn-primary">
              {saving ? <><Refresh className="h-4 w-4 animate-spin" /> 提交中…</> : '同意并继续'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

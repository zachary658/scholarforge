import { useState } from 'react';
import { Shield, Check, AlertCircle, ChevronDown, Pen, Sparkle } from './Icons.jsx';

// 审校链结果面板（借鉴 GPT Researcher reviewer→revisor 闭环）：
// 流程状态条（初稿 → AI 审校 → 自动修订 → 复核）+ 规则发现 + 可折叠审校报告
export default function ReviewChainPanel({ chain, report }) {
  const [openReport, setOpenReport] = useState(false);
  if (!chain) return null;

  const verdictPassed = chain.verdict === 'pass';
  const recheckPassed = chain.recheckVerdict === 'pass';
  const errors = chain.findings?.errors || [];
  const warnings = chain.findings?.warnings || [];
  const initialErrors = chain.initialFindings?.errors || [];
  const fixedCount = Math.max(0, initialErrors.length - errors.length);

  // 步骤定义：修订环节仅在实际发生（或被安全审核拦下）时展示
  const steps = [
    { key: 'draft', label: '初稿生成', state: 'done' },
    {
      key: 'review',
      label: 'AI 审校',
      state: 'done',
      badge: verdictPassed ? '通过' : '需修改',
      badgeCls: verdictPassed ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600',
    },
  ];
  if (chain.revised || chain.reviseNote) {
    steps.push({
      key: 'revise',
      label: '自动修订',
      state: chain.revised ? 'done' : 'warn',
      badge: chain.revised ? (fixedCount > 0 ? `修复 ${fixedCount} 处` : '已修订') : '已保留原稿',
      badgeCls: chain.revised ? 'bg-accent-50 text-accent' : 'bg-amber-50 text-amber-600',
    });
    steps.push({
      key: 'recheck',
      label: '复核',
      state: chain.recheckVerdict == null ? 'warn' : recheckPassed ? 'done' : 'warn',
      badge: chain.recheckVerdict == null ? '未执行' : recheckPassed ? '通过' : '仍有问题',
      badgeCls: chain.recheckVerdict == null ? 'bg-slate-100 text-slate-500' : recheckPassed ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600',
    });
  }

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      {/* 流程状态条 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
          <Shield className="h-4 w-4 text-accent" /> 质量审校链
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {steps.map((s, i) => (
            <span key={s.key} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight />}
              <span className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
                s.state === 'done' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
              }`}>
                {s.state === 'done'
                  ? <Check className="h-3.5 w-3.5" />
                  : <AlertCircle className="h-3.5 w-3.5" />}
                {s.label}
                {s.badge ? (
                  <span className={`rounded px-1 py-0.5 text-[10px] font-medium ${s.badgeCls}`}>{s.badge}</span>
                ) : null}
              </span>
            </span>
          ))}
        </div>
        {chain.revised && (
          <span className="ml-auto flex items-center gap-1 rounded-md bg-accent-50 px-2 py-1 text-xs font-medium text-accent">
            <Sparkle className="h-3.5 w-3.5" /> 已自动修订并重新生成 Word
          </span>
        )}
      </div>

      {chain.reviseNote && (
        <p className="mt-2 flex items-center gap-1 text-xs text-amber-600">
          <Pen className="h-3.5 w-3.5" /> {chain.reviseNote}
        </p>
      )}

      {/* 规则审校发现 */}
      {(errors.length > 0 || warnings.length > 0) && (
        <div className="mt-3 space-y-1.5">
          {errors.map((e, i) => (
            <div key={`e${i}`} className="flex items-start gap-1.5 text-xs text-red-600">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{typeof e === 'string' ? e : e.detail}</span>
            </div>
          ))}
          {warnings.map((w, i) => (
            <div key={`w${i}`} className="flex items-start gap-1.5 text-xs text-slate-500">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
              <span>{typeof w === 'string' ? w : w.detail}</span>
            </div>
          ))}
        </div>
      )}
      {errors.length === 0 && warnings.length === 0 && (
        <p className="mt-2 flex items-center gap-1 text-xs text-emerald-600">
          <Check className="h-3.5 w-3.5" /> 规则检查未发现问题：引用编号与参考文献一一对应，无占位符残留
        </p>
      )}

      {/* 完整审校报告（折叠） */}
      {report && (
        <div className="mt-3 border-t border-slate-200 pt-2">
          <button
            onClick={() => setOpenReport((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-ink"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${openReport ? 'rotate-180' : ''}`} />
            {openReport ? '收起审校报告' : '展开完整审校报告'}
          </button>
          {openReport && (
            <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white p-3 font-sans text-xs leading-relaxed text-slate-600 shadow-inner">
              {report}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function ChevronRight() {
  return (
    <svg className="h-3 w-3 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

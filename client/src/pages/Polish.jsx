import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useTool } from '../lib/useTool.js';
import RechargeBanner from '../components/RechargeBanner.jsx';
import { Sparkle, Copy, Download, Refresh, ArrowRight, Check, Crown, Gift } from '../components/Icons.jsx';

const modes = [
  { value: 'polish', label: '学术润色' },
  { value: 'translate', label: '中英互译' },
  { value: 'grammar', label: '语法纠错' },
];

function copyText(text) {
  navigator.clipboard?.writeText(text);
}

const SAMPLE = '我觉得深度学习很重要，所以本文做研究来看一下这个方法。但是数据比较少，还有就是模型很复杂，所以结果不太稳定。';

export default function Polish() {
  const { refreshStatus, status } = useOutletContext();
  const tool = useTool(refreshStatus);

  const [mode, setMode] = useState('polish');
  const [direction, setDirection] = useState('zh2en');
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const total = status?.total ?? 0;
  const balance = status?.balance ?? 0;
  const signup = status?.signup ?? 0;

  // 兼容字段：免费路径返回 result，付费路径返回 content
  const r = tool.result;
  const output = r ? (r.content || r.result || '') : '';
  const changes = r?.changes || [];
  const issues = r?.issues || [];

  const run = () => {
    if (!input.trim()) {
      tool.setError('请输入需要处理的文本');
      return;
    }
    tool.run(async () => {
      if (mode === 'polish') return api.polish({ text: input });
      if (mode === 'translate') return api.translate({ text: input, direction });
      return api.grammar({ text: input });
    });
  };

  const switchMode = (m) => {
    setMode(m);
    tool.reset();
  };

  const handleCopy = () => {
    copyText(output);
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
  };

  const downloadText = () => {
    const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${modes.find((m) => m.value === mode)?.label}结果.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col px-8 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">润色与翻译</h1>
          <p className="mt-1 text-sm text-slate-500">学术润色、中英互译、语法纠错，提升论文表达质量</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="flex items-center gap-1"><Gift className="h-3.5 w-3.5 text-accent" />可用 {total}</span>
          <span className="text-slate-300">|</span>
          <span className="flex items-center gap-1"><Crown className="h-3 w-3 text-amber-500" />积分 {balance}</span>
          <span className="text-slate-300">|</span>
          <span>赠送 {signup}</span>
        </div>
      </div>

      {/* 模式切换 */}
      <div className="mb-5 inline-flex rounded-lg border border-slate-200 bg-white p-1">
        {modes.map((m) => (
          <button
            key={m.value}
            onClick={() => switchMode(m.value)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              mode === m.value ? 'bg-accent text-white' : 'text-slate-600 hover:text-ink'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="grid flex-1 gap-4 lg:grid-cols-2">
        {/* 原文 */}
        <div className="card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <span className="text-sm font-medium text-slate-600">原文</span>
            <div className="flex items-center gap-2">
              {mode === 'translate' && (
                <select
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600"
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                >
                  <option value="zh2en">中 → 英</option>
                  <option value="en2zh">英 → 中</option>
                </select>
              )}
              <button onClick={() => setInput(SAMPLE)} className="btn-ghost text-xs">示例</button>
            </div>
          </div>
          <textarea
            className="flex-1 resize-none border-0 p-5 font-serif text-[14px] leading-[1.85] text-slate-700 focus:outline-none focus:ring-0"
            placeholder={mode === 'translate' ? (direction === 'zh2en' ? '输入中文文本…' : 'Input English text…') : '粘贴需要处理的文本…'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>

        {/* 结果 */}
        <div className="card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <span className="text-sm font-medium text-slate-600">结果</span>
            {output && (
              <div className="flex items-center gap-1">
                <button onClick={handleCopy} className="btn-ghost text-xs">
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                  {copied ? '已复制' : '复制'}
                </button>
                <button onClick={downloadText} className="btn-ghost text-xs">
                  <Download className="h-4 w-4" /> 下载
                </button>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            {output ? (
              <>
                {/* 计费信息条 */}
                {r?.chargeType && (
                  <div className="mb-3 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    {r.chargeType === 'paid' ? (
                      <span className="rounded bg-accent-50 px-1.5 py-0.5 font-medium text-accent">已付费 ¥{Number(r.amount || 0).toFixed(2)}</span>
                    ) : r.chargeType === 'points' ? (
                      <><Crown className="h-3.5 w-3.5 text-amber-500" /><span>已消耗积分</span></>
                    ) : r.chargeType === 'free_signup' ? (
                      <><Gift className="h-3.5 w-3.5 text-accent" /><span>已消耗 1 次赠送额度</span></>
                    ) : null}
                  </div>
                )}
                <pre className="whitespace-pre-wrap font-serif text-[14px] leading-[1.85] text-slate-700">{output}</pre>
                {changes.length > 0 && (
                  <div className="mt-4 rounded-lg border border-accent-100 bg-accent-50 p-3">
                    <div className="text-xs font-semibold text-accent">润色说明</div>
                    <ul className="mt-1.5 space-y-1">
                      {changes.map((c, i) => (
                        <li key={i} className="text-xs text-slate-600">· {c}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {issues.length > 0 && (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div className="text-xs font-semibold text-amber-700">检测结果</div>
                    <ul className="mt-1.5 space-y-1">
                      {issues.map((c, i) => (
                        <li key={i} className="text-xs text-slate-600">
                          · {typeof c === 'string'
                            ? c
                            : `${c.message}${c.suggestion && c.suggestion !== c.original ? `（建议：${c.suggestion}）` : ''}`}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <ArrowRight className="h-8 w-8 text-slate-300" />
                <p className="mt-3 text-sm text-slate-400">处理结果将显示在此处</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 操作栏 */}
      <div className="mt-5 flex items-center justify-between">
        <span className="text-xs text-slate-500">
          {total > 0 ? `本次消耗 1 次额度 · 剩余 ${total} 次` : '当前无额度，本次按功能价格付费'}
        </span>
        <button onClick={run} disabled={tool.loading} className="btn-primary px-6 py-2.5">
          {tool.loading ? (
            <><Refresh className="h-4 w-4 animate-spin" /> 处理中…</>
          ) : (
            <>
              <Sparkle className="h-4 w-4" />
              {mode === 'polish' ? '润色' : mode === 'translate' ? '翻译' : '检查'}
            </>
          )}
        </button>
      </div>
      {tool.error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{tool.error}</div>
      )}

      {tool.needRecharge && (
        <RechargeBanner balance={tool.needRecharge.balance} needed={tool.needRecharge.needed} />
      )}
    </div>
  );
}

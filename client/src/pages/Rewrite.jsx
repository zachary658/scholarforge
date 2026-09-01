import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useTool } from '../lib/useTool.js';
import { copyText } from '../lib/utils.js';
import FeaturePay from '../components/FeaturePay.jsx';
import DocRewritePanel from '../components/DocRewritePanel.jsx';
import AcademicIntegrityModal from '../components/AcademicIntegrityModal.jsx';
import { useAcademicIntegrity } from '../lib/useAcademicIntegrity.js';
import { toast } from '../components/Toast.jsx';
import {
  Refresh, Copy, Check, Sparkle, Download,
} from '../components/Icons.jsx';

const SAMPLE =
  '近年来，深度学习发展迅速，广泛应用于计算机视觉领域。研究表明，深度学习方法在图像识别任务中表现优异。' +
  '所以本文采用深度学习方法分析问题。但是数据比较少，而且模型非常复杂，所以结果不太稳定。' +
  '通过实验分析，我们发现该方法有效。';

export default function Rewrite() {
  const tool = useTool();

  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef(null);
  const integrity = useAcademicIntegrity();
  const [mode, setMode] = useState('text'); // text=文本模式 / doc=整篇文档模式

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const r = tool.result;
  const output = r?.result || r?.content || '';
  const changes = r?.changes || [];

  const run = (orderNo) => {
    if (!input.trim()) {
      toast.warning('请输入需要降重的文本');
      return;
    }
    if (!integrity.ensure(() => run(orderNo))) return;
    tool.run(() => api.rewrite({ text: input, orderNo: orderNo || undefined }));
  };

  const handleCopy = async () => {
    const ok = await copyText(output, '降重结果');
    if (!ok) return;
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
  };

  const downloadText = () => {
    try {
      const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '降重结果.txt';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('结果已下载');
    } catch (err) {
      toast.error('下载失败：' + err.message);
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col px-8 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">论文降重</h1>
          <p className="mt-1 text-sm text-slate-500">通过同义词替换、句式变换与表达调整降低文本重复率，保持原意与学术性</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-slate-200 p-1">
          <button
            onClick={() => setMode('text')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${mode === 'text' ? 'bg-accent text-white' : 'text-slate-500 hover:text-ink'}`}
          >
            文本模式
          </button>
          <button
            onClick={() => setMode('doc')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${mode === 'doc' ? 'bg-accent text-white' : 'text-slate-500 hover:text-ink'}`}
          >
            整篇文档模式
          </button>
        </div>
      </div>

      {mode === 'doc' ? (
        <DocRewritePanel mode="rewrite" />
      ) : (
        <>
      <div className="grid flex-1 gap-4 lg:grid-cols-2">
        {/* 原文输入 */}
        <div className="card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <span className="text-sm font-medium text-slate-600">原文</span>
            <button onClick={() => setInput(SAMPLE)} className="btn-ghost text-xs">示例</button>
          </div>
          <textarea
            className="flex-1 resize-none border-0 p-5 font-serif text-[14px] leading-[1.85] text-slate-700 focus:outline-none focus:ring-0"
            placeholder="粘贴需要降重的论文段落…将自动进行同义改写与句式调整"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-2 text-xs text-slate-400">
            <span>字数：{input.length}</span>
          </div>
        </div>

        {/* 降重结果 */}
        <div className="card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <span className="text-sm font-medium text-slate-600">降重结果</span>
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
            {r ? (
              <>
                {/* 计费信息条 */}
                {r.chargeType && (
                  <div className="mb-3 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    {r.chargeType === 'paid' ? (
                      <span className="rounded bg-accent-50 px-1.5 py-0.5 font-medium text-accent">已付费 ¥{Number(r.amount || 0).toFixed(2)}</span>
                    ) : null}
                  </div>
                )}

                {/* 内置引擎提示：本次改写未调用 AI 模型时告知用户 */}
                {r.engine === 'builtin' && (
                  <div className="mb-3 text-xs text-slate-500">本次改写由内置规则引擎完成，未调用 AI 模型</div>
                )}

                {/* 降重后文本 */}
                {output && (
                  <div className="mb-4">
                    <div className="mb-2 text-xs font-semibold text-slate-500">降重后文本</div>
                    <pre className="whitespace-pre-wrap rounded-lg border border-slate-100 bg-white p-4 font-serif text-[14px] leading-[1.85] text-slate-700">{output}</pre>
                  </div>
                )}

                {/* 修改记录 */}
                {changes.length > 0 && (
                  <div>
                    <div className="mb-2 text-xs font-semibold text-slate-500">修改记录（{changes.length}）</div>
                    <div className="rounded-lg border border-accent-100 bg-accent-50 p-3">
                      <ul className="space-y-1">
                        {changes.map((c, i) => (
                          <li key={i} className="text-xs text-slate-600">· {c}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {/* 连贯性提示 */}
                {r.coherence && !r.coherence.ok && (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div className="text-xs font-semibold text-amber-700">连贯性提示（请核对）</div>
                    <ul className="mt-1 space-y-1">
                      {r.coherence.issues.map((iss, i) => <li key={i} className="text-xs text-amber-600">· {iss}</li>)}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <Refresh className="h-8 w-8 text-slate-300" />
                <p className="mt-3 text-sm text-slate-400">粘贴文本后点击「开始降重」</p>
                <p className="mt-1 text-xs text-slate-400">结果包含降重后文本与修改记录</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 操作栏 */}
      <div className="mt-5 flex items-center justify-between">
        <span className="text-xs text-slate-500">本功能为付费功能，先下单支付后再生成</span>
        <button onClick={() => run()} disabled={tool.loading} className="btn-primary px-6 py-2.5">
          {tool.loading ? (
            <><Refresh className="h-4 w-4 animate-spin" /> 降重中…</>
          ) : (
            <><Sparkle className="h-4 w-4" /> 开始降重</>
          )}
        </button>
      </div>
      {tool.error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{tool.error}</div>
      )}

      {tool.needOrder && (
        <FeaturePay needOrder={tool.needOrder} onPaid={(orderNo) => run(orderNo)} onClose={() => tool.cancelOrder()} />
      )}

      {integrity.show && (
        <AcademicIntegrityModal onAgreed={integrity.handleAgreed} onCancel={integrity.close} />
      )}
        </>
      )}
    </div>
  );
}

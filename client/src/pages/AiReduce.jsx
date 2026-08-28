import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useTool } from '../lib/useTool.js';
import { copyText } from '../lib/utils.js';
import FeaturePay from '../components/FeaturePay.jsx';
import DocRewritePanel from '../components/DocRewritePanel.jsx';
import AcademicIntegrityModal from '../components/AcademicIntegrityModal.jsx';
import { useAcademicIntegrity } from '../lib/useAcademicIntegrity.js';
import { toast } from '../components/Toast.jsx';
import { Refresh, Copy, Check, Sparkle, Download, Shield } from '../components/Icons.jsx';

const SAMPLE =
  '首先，本研究旨在探讨深度学习在医学影像识别中的应用。其次，通过对卷积神经网络模型的改进，可以提升识别准确率。' +
  '此外，本研究采用了多种数据增强方法。最后，实验结果表明该方法具有显著优势。综上所述，深度学习在医学影像领域具有广阔的应用前景。';

export default function AiReduce() {
  const tool = useTool();

  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState('single');
  const [viewMode, setViewMode] = useState('text'); // text=文本模式 / doc=整篇文档模式
  const copyTimerRef = useRef(null);
  const integrity = useAcademicIntegrity();

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const r = tool.result;
  const output = r?.result || r?.content || '';
  const versions = r?.versions || [];

  const run = (orderNo) => {
    if (!input.trim()) {
      toast.warning('请输入需要降AI的文本');
      return;
    }
    if (!integrity.ensure(() => run(orderNo))) return;
    const payload = { text: input, orderNo: orderNo || undefined };
    tool.run(() => (mode === 'versions' ? api.aiReduceVersions(payload) : api.aiReduce(payload)));
  };

  const handleCopy = async () => {
    const ok = await copyText(output, '结果');
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
      a.download = '降AI结果.txt';
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
          <h1 className="text-xl font-bold text-ink">降AI率</h1>
          <p className="mt-1 text-sm text-slate-500">智能改写消除 AI 痕迹，让文本读起来更像人类写作，同时保留原意与学术性</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-slate-200 p-1">
          <button
            onClick={() => setViewMode('text')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${viewMode === 'text' ? 'bg-accent text-white' : 'text-slate-500 hover:text-ink'}`}
          >
            文本模式
          </button>
          <button
            onClick={() => setViewMode('doc')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${viewMode === 'doc' ? 'bg-accent text-white' : 'text-slate-500 hover:text-ink'}`}
          >
            整篇文档模式
          </button>
        </div>
      </div>

      {viewMode === 'doc' ? (
        <DocRewritePanel mode="ai_reduce" />
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
            placeholder="粘贴需要降AI的论文段落…将自动消除 AI 写作痕迹"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-2 text-xs text-slate-400">
            <span>字数：{input.length}</span>
          </div>
        </div>

        {/* 降AI结果 */}
        <div className="card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <span className="text-sm font-medium text-slate-600">降AI后文本</span>
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
            {versions.length > 0 ? (
              <div className="space-y-3">
                {versions.map((v, i) => (
                  <div key={i} className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-500">版本 {i + 1}</span>
                      <button
                        onClick={() => { setInput(v); setMode('single'); tool.reset(); }}
                        className="text-xs font-medium text-accent hover:underline"
                      >
                        选用此版本
                      </button>
                    </div>
                    <pre className="whitespace-pre-wrap font-serif text-[13px] leading-[1.7] text-slate-700">{v}</pre>
                  </div>
                ))}
              </div>
            ) : output ? (
              <pre className="whitespace-pre-wrap font-serif text-[14px] leading-[1.85] text-slate-700">{output}</pre>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <Shield className="h-8 w-8 text-slate-300" />
                <p className="mt-3 text-sm text-slate-400">粘贴文本后点击「一键降AI」</p>
                <p className="mt-1 text-xs text-slate-400">结果将输出改写后的自然、人类化文本</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 操作栏 */}
      <div className="mt-5 flex items-center justify-between">
        <span className="text-xs text-slate-500">本功能为付费功能，先下单支付后再生成</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setMode(mode === 'single' ? 'versions' : 'single'); tool.reset(); }}
            className={`btn-ghost text-xs ${mode === 'versions' ? 'bg-accent-50 text-accent' : ''}`}
          >
            {mode === 'versions' ? '多版本模式' : '单版本模式'}
          </button>
          <button onClick={() => run()} disabled={tool.loading} className="btn-primary px-6 py-2.5">
            {tool.loading ? (
              <><Refresh className="h-4 w-4 animate-spin" /> 降AI中…</>
            ) : (
              <><Sparkle className="h-4 w-4" /> {mode === 'versions' ? '生成多版本' : '一键降AI'}</>
            )}
          </button>
        </div>
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

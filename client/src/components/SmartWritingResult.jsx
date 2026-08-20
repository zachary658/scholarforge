import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Copy, Check, Brain, Book, Layers, Table, BadgeCheck, ArrowRight,
} from './Icons.jsx';

// 深度文献调研结果展示：状态条 + 四标签（深度调研大纲 / 研究框架 / 文献 / 数据表格）
// 供 Writing 页大纲生成后"深度文献调研"付费升级复用
export default function SmartWritingResult({ result }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState('outline');
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef(null);

  // 组件卸载时清理复制反馈定时器，避免内存泄漏
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const framework = result?.framework || null;
  const benchmarks = result?.benchmarks?.data || [];
  const tables = result?.tables || [];
  const references = result?.references || [];

  const handleCopy = async () => {
    if (!result?.outline) return;
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(result.outline);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch { /* 忽略复制失败 */ }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 状态条 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-2.5 text-xs">
        <span className={`rounded px-2 py-0.5 font-medium ${result.degraded ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
          {result.degraded ? '标准模式' : '深度解析'}
        </span>
        <span className="text-slate-500">检索 {references.length} 篇文献</span>
        <span className="text-slate-500">· {framework?.paperCount || 0} 篇完成深度解析</span>
        {framework?.perspectives_used?.length > 0 && (
          <span className="text-slate-500">· {framework.perspectives_used.length} 个研究角度</span>
        )}
        <span className="ml-auto flex items-center gap-1 text-accent">
          <BadgeCheck className="h-3.5 w-3.5" /> 已存入工作区
        </span>
      </div>

      {/* 标签页切换 */}
      <div className="flex gap-1 border-b border-slate-100 px-5 pt-2">
        {[
          { key: 'outline', label: '深度调研大纲', icon: Layers },
          { key: 'framework', label: '研究框架', icon: Brain },
          { key: 'refs', label: `文献 (${references.length})`, icon: Book },
          { key: 'data', label: `数据/表格 (${benchmarks.length + tables.length})`, icon: Table },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-medium transition ${
              tab === t.key
                ? 'border-b-2 border-accent text-accent'
                : 'text-slate-500 hover:text-ink'
            }`}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {tab === 'outline' && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <button onClick={handleCopy} className="btn-ghost text-xs">
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                {copied ? '已复制' : '复制大纲'}
              </button>
            </div>
            {result.outline ? (
              <pre className="whitespace-pre-wrap font-serif text-[14px] leading-[1.85] text-slate-700">{result.outline}</pre>
            ) : (
              <p className="text-sm text-slate-400">未生成大纲</p>
            )}
            <div className="mt-4 rounded-lg bg-accent-50 px-4 py-3 text-xs text-accent">
              下一步：在论文工作区确认大纲后，即可分章节生成正文（每章自动引用上述真实文献与数据）。
              <button
                onClick={() => navigate('/app/projects')}
                className="ml-2 inline-flex items-center gap-1 font-semibold underline"
              >
                去工作区 <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}

        {tab === 'framework' && (
          <div className="space-y-4">
            {framework?.perspectives?.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-ink">研究角度与方法分布</h3>
                <div className="space-y-2">
                  {framework.perspectives.map((p) => (
                    <div key={p.view} className="rounded-lg bg-slate-50 px-3 py-2">
                      <div className="text-xs font-semibold text-accent">{p.view}</div>
                      <div className="mt-1 text-xs text-slate-600">
                        {(p.methods || []).join('；') || '（无方法）'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">主要研究方法（按出现频率）</h3>
              <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
                {(framework?.methods || []).map((m, i) => <li key={i}>{m}</li>)}
                {(framework?.methods || []).length === 0 && <li className="text-slate-400">（未提取到）</li>}
              </ul>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">主要创新点</h3>
              <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
                {(framework?.innovations || []).map((m, i) => <li key={i}>{m}</li>)}
                {(framework?.innovations || []).length === 0 && <li className="text-slate-400">（未提取到）</li>}
              </ul>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">主要结论</h3>
              <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
                {(framework?.conclusions || []).map((m, i) => <li key={i}>{m}</li>)}
                {(framework?.conclusions || []).length === 0 && <li className="text-slate-400">（未提取到）</li>}
              </ul>
            </div>
          </div>
        )}

        {tab === 'refs' && (
          <div className="space-y-2">
            {references.map((r, i) => (
              <div key={i} className="rounded-lg border border-slate-100 px-3 py-2">
                <div className="text-sm font-medium text-ink">
                  [{i + 1}] {r.title}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {r.authors || '佚名'} · {r.journal || '未知来源'} · {r.year || '未知年份'}
                  {r.source_db && <span className="ml-2 rounded bg-slate-100 px-1 py-0.5 text-[10px]">{r.source_db}</span>}
                  {r.source_url && (
                    <a href={r.source_url} target="_blank" rel="noreferrer" className="ml-2 text-accent hover:underline">原文链接</a>
                  )}
                </div>
              </div>
            ))}
            {references.length === 0 && <p className="text-sm text-slate-400">未检索到文献（标准模式）</p>}
          </div>
        )}

        {tab === 'data' && (
          <div className="space-y-4">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">可参考的实验数据（对比图表自动标注来源）</h3>
              {benchmarks.length > 0 ? (
                <div className="space-y-2">
                  {benchmarks.map((b, i) => (
                    <div key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
                      <div className="font-medium text-slate-700">{b.paperTitle}（{b.paperYear}）</div>
                      <div className="mt-1 text-slate-500">
                        {(b.metrics || []).map((m) => `${m.label}=${m.value}`).join('，')}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">摘要未提取到性能指标（可在工作区上传 Excel 数据图表）</p>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">可参考的表格数据（自动标注来源）</h3>
              {tables.length > 0 ? (
                <div className="space-y-3">
                  {tables.map((t, i) => (
                    <div key={i} className="overflow-x-auto rounded-lg border border-slate-100">
                      <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
                        数据引自：{t.source}{t.year ? `，${t.year}` : ''}
                        {t.from_mineru && <span className="ml-2 rounded bg-accent-50 px-1 py-0.5 text-[10px] text-accent">高精度解析</span>}
                      </div>
                      <table className="w-full text-xs">
                        <tbody>
                          {(t.rows || []).map((row, ri) => (
                            <tr key={ri} className={ri === 0 ? 'border-b border-slate-200 font-medium text-slate-700' : 'text-slate-600'}>
                              {row.map((cell, ci) => (
                                <td key={ci} className="border-r border-slate-100 px-2 py-1 last:border-r-0">{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">未提取到表格数据</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

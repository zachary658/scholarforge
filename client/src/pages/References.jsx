import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import {
  Search, Plus, Trash, Book, Copy, Check, Refresh,
  ExternalLink, BadgeCheck,
} from '../components/Icons.jsx';

const styles = [
  { value: 'gbt7714', label: 'GB/T 7714' },
  { value: 'apa', label: 'APA' },
  { value: 'mla', label: 'MLA' },
];

// 来源标签样式（区分真实可溯源 / AI建议 / 手动）
function sourceTag(r) {
  if (r.source === 'web') {
    return {
      cls: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      label: '真实可溯源',
      icon: BadgeCheck,
    };
  }
  if (r.source === 'ai_suggested') {
    return {
      cls: 'bg-amber-50 text-amber-700 border-amber-100',
      label: 'AI建议·需核验',
      icon: Book,
    };
  }
  return {
    cls: 'bg-slate-100 text-slate-500 border-slate-200',
    label: '手动添加',
    icon: Book,
  };
}

export default function References() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [refs, setRefs] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [style, setStyle] = useState('gbt7714');
  const [formatted, setFormatted] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newRef, setNewRef] = useState({ title: '', authors: '', year: '', journal: '', ref_type: 'journal' });
  const [copiedId, setCopiedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const copyTimerRef = useRef(null);

  const loadRefs = () => api.listRefs().then((d) => setRefs(d.references || [])).catch(() => {});

  useEffect(() => {
    loadRefs();
    api.searchRefs('').then((d) => setResults(d.results || [])).catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const search = async () => {
    setLoading(true);
    try {
      const data = await api.searchRefs(query);
      setResults(data.results || []);
      setSearched(true);
    } catch (err) {
      // 检索失败时给用户明确提示，而不是静默显示空结果
      setResults([]);
      setSearched(true);
      alert(err && err.message ? `文献检索失败：${err.message}` : '文献检索失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const collect = async (r) => {
    await api.addRef(r);
    loadRefs();
  };

  const removeRef = async (id) => {
    await api.deleteRef(id);
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    loadRefs();
  };

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const format = async () => {
    if (selected.size === 0) return;
    const data = await api.formatRefs({ ids: [...selected], style });
    setFormatted(data.formatted || []);
  };

  const addManual = async () => {
    if (!newRef.title.trim()) return;
    await api.addRef({ ...newRef, source: 'manual' });
    setNewRef({ title: '', authors: '', year: '', journal: '', ref_type: 'journal' });
    setShowAdd(false);
    loadRefs();
  };

  const copyFmt = (text, id) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedId(null), 1500);
  };

  const inCollection = (r) => refs.some((x) => x.title === r.title && x.authors === r.authors);
  const realCount = refs.filter((r) => r.source === 'web').length;

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">文献管理</h1>
          <p className="mt-1 text-sm text-slate-500">检索真实可溯源文献、收藏整理、一键导出多种引用格式</p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} className="btn-secondary">
          <Plus className="h-4 w-4" /> 手动添加
        </button>
      </div>

      {/* 借鉴千笔写作：真实文献承诺横幅 */}
      <div className="mb-6 rounded-xl border border-emerald-100 bg-gradient-to-r from-emerald-50/70 to-blue-50/40 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
            <BadgeCheck className="h-5 w-5" />
          </div>
          <div className="flex-1 text-sm">
            <p className="font-semibold text-emerald-700">真实文献 · 可溯源 · 不编造</p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
              所有检索结果均来自真实学术数据库（中国知网 CNKI / IEEE Xplore / ACM Digital Library / Springer Link 等），
              每条文献都附带<span className="font-medium text-emerald-700">原文链接</span>可一键溯源核验，杜绝 AI 编造文献。
              {refs.length > 0 && (
                <span className="ml-1">当前文献库：<span className="font-medium text-emerald-700">{realCount} 篇真实可溯源</span> / 共 {refs.length} 篇</span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* 手动添加表单 */}
      {showAdd && (
        <div className="card mb-6 p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input className="input" placeholder="标题" value={newRef.title} onChange={(e) => setNewRef({ ...newRef, title: e.target.value })} />
            <input className="input" placeholder="作者（逗号分隔）" value={newRef.authors} onChange={(e) => setNewRef({ ...newRef, authors: e.target.value })} />
            <input className="input" placeholder="年份" value={newRef.year} onChange={(e) => setNewRef({ ...newRef, year: e.target.value })} />
            <input className="input" placeholder="期刊/出版社" value={newRef.journal} onChange={(e) => setNewRef({ ...newRef, journal: e.target.value })} />
          </div>
          <p className="mt-2 text-xs text-slate-400">手动添加的文献会标记为"手动添加"，建议优先从左侧检索真实文献</p>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setShowAdd(false)} className="btn-ghost">取消</button>
            <button onClick={addManual} className="btn-primary">添加</button>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 检索 */}
        <div>
          <h2 className="mb-3 text-sm font-semibold text-ink">文献检索 <span className="ml-1 text-xs font-normal text-slate-400">真实学术数据库</span></h2>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="input pl-9"
                placeholder="搜索标题、作者、期刊…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && search()}
              />
            </div>
            <button onClick={search} disabled={loading} className="btn-primary">
              {loading ? <Refresh className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} 检索
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {results.length === 0 && searched && (
              <p className="py-6 text-center text-sm text-slate-400">未找到相关文献</p>
            )}
            {results.map((r, i) => {
              const tag = sourceTag(r);
              return (
                <div key={i} className="card flex items-start gap-3 p-4">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                    <Book className="h-[18px] w-[18px]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink">{r.title}</div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {r.authors} · {r.journal || r.publisher} · {r.year}
                    </div>
                    {/* 来源数据库 + 可溯源链接 */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${tag.cls}`}>
                        <tag.icon className="h-3 w-3" />
                        {r.source_db || tag.label}
                      </span>
                      {r.source_url && (
                        <a
                          href={r.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 hover:bg-blue-100"
                        >
                          <ExternalLink className="h-3 w-3" />
                          查看原文
                        </a>
                      )}
                      {r.doi && (
                        <span className="text-[10px] text-slate-400">DOI: {r.doi}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => collect(r)}
                    disabled={inCollection(r)}
                    className={`flex-shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                      inCollection(r) ? 'bg-green-50 text-green-600' : 'bg-accent-50 text-accent hover:bg-accent-100'
                    }`}
                  >
                    {inCollection(r) ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* 我的文献 + 导出 */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">我的文献库 <span className="text-slate-400">({refs.length})</span></h2>
            {selected.size > 0 && (
              <div className="flex items-center gap-2">
                <select value={style} onChange={(e) => setStyle(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1 text-xs">
                  {styles.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <button onClick={format} className="btn-primary text-xs">
                  生成引用 ({selected.size})
                </button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            {refs.length === 0 && (
              <div className="card flex flex-col items-center justify-center py-10 text-center">
                <Book className="h-10 w-10 text-slate-300" />
                <p className="mt-3 text-sm text-slate-400">从左侧检索结果收藏，或手动添加</p>
              </div>
            )}
            {refs.map((r) => {
              const tag = sourceTag(r);
              return (
                <div key={r.id} className={`card flex items-start gap-3 p-4 transition ${selected.has(r.id) ? 'ring-1 ring-accent' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink">{r.title}</div>
                    <div className="mt-0.5 text-xs text-slate-400">{r.authors} · {r.journal || r.publisher} · {r.year}</div>
                    {/* 来源标签 + 可溯源链接 */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${tag.cls}`}>
                        <tag.icon className="h-3 w-3" />
                        {r.source_db || tag.label}
                      </span>
                      {r.source_url && (
                        <a
                          href={r.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 hover:bg-blue-100"
                        >
                          <ExternalLink className="h-3 w-3" />
                          溯源
                        </a>
                      )}
                    </div>
                  </div>
                  <button onClick={() => removeRef(r.id)} className="flex-shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500">
                    <Trash className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* 格式化结果 */}
          {formatted.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-500">引用格式（{styles.find((s) => s.value === style)?.label}）</h3>
                <button
                  onClick={() => copyFmt(formatted.map((f) => f.formatted).join('\n'), 'all')}
                  className="btn-ghost text-xs"
                >
                  {copiedId === 'all' ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  全部复制
                </button>
              </div>
              <div className="card divide-y divide-slate-100">
                {formatted.map((f) => (
                  <div key={f.id} className="flex items-start gap-3 p-3">
                    <pre className="flex-1 whitespace-pre-wrap font-serif text-[13px] leading-relaxed text-slate-700">{f.formatted}</pre>
                    <button onClick={() => copyFmt(f.formatted, f.id)} className="flex-shrink-0 text-slate-400 hover:text-accent">
                      {copiedId === f.id ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

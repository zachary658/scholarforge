import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { FileSearch, Refresh, Download, ChartBar, Layers, Plus } from '../components/Icons.jsx';
import { toast } from '../components/Toast.jsx';

const CHART_TYPES = [
  { value: 'bar', label: '柱状图' },
  { value: 'line', label: '折线图' },
  { value: 'pie', label: '饼图' },
  { value: 'scatter', label: '散点图' },
];

export default function Charts() {
  const [searchParams] = useSearchParams();
  const initialProjectId = searchParams.get('projectId') || '';
  const fileRef = useRef(null);
  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);
  const [x, setX] = useState('');
  const [y, setY] = useState('');
  const [chartType, setChartType] = useState('bar');
  const [title, setTitle] = useState('');
  const [charts, setCharts] = useState([]);
  const [rendering, setRendering] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [current, setCurrent] = useState(null); // 最近渲染的图表

  // 插入相关
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [chapters, setChapters] = useState([]);
  const [chapterId, setChapterId] = useState('');

  const loadCharts = () => api.listCharts(projectId ? { projectId } : {}).then((d) => setCharts(d.charts || [])).catch(() => {});
  const loadProjects = () => api.listProjects().then((d) => setProjects(d.projects || [])).catch(() => {});

  useEffect(() => { loadCharts(); loadProjects(); }, [projectId]);

  useEffect(() => {
    if (projectId) {
      api.getChapters(projectId).then((d) => setChapters(d.chapters || [])).catch(() => setChapters([]));
    } else {
      setChapters([]);
    }
  }, [projectId]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const data = await api.uploadChart(file);
      setColumns(data.columns || []);
      setRows(data.rows || []);
      setX(data.columns?.[0] || '');
      setY(data.columns?.[1] || '');
      toast.success(`已解析 ${data.total ?? data.rows?.length ?? 0} 行数据`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const render = async () => {
    if (!x || !y) { toast.warning('请选择 X 轴和 Y 轴字段'); return; }
    setRendering(true);
    try {
      const data = await api.renderChart({ title, chart_type: chartType, x, y, rows, projectId: projectId ? Number(projectId) : undefined });
      setCurrent(data.chart);
      loadCharts();
      toast.success('图表已生成');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRendering(false);
    }
  };

  const insert = async () => {
    if (!current) { toast.warning('请先生成图表'); return; }
    if (!projectId || !chapterId) { toast.warning('请选择目标论文与章节'); return; }
    try {
      await api.insertChart(current.id, { projectId: Number(projectId), chapterId });
      toast.success('已插入到章节');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-ink">数据图表</h1>
        <p className="mt-1 text-sm text-slate-500">上传 Excel/CSV，选择字段与图表类型，生成学术风格 PNG，可下载或一键插入论文</p>
        {projectId && projects.find((p) => String(p.id) === String(projectId)) && (
          <p className="mt-1 text-xs font-medium text-accent">已关联论文：{projects.find((p) => String(p.id) === String(projectId)).title}</p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 左侧：上传 + 配置 */}
        <div className="card p-6">
          <div className="flex items-center gap-2">
            <ChartBar className="h-5 w-5 text-accent" />
            <h3 className="text-sm font-semibold text-ink">生成图表</h3>
          </div>

          <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center hover:bg-slate-100">
            <FileSearch className="h-6 w-6 text-slate-400" />
            <span className="mt-2 text-sm text-slate-600">{uploading ? '解析中…' : '点击上传 Excel / CSV'}</span>
            <span className="mt-1 text-xs text-slate-400">支持 .xlsx / .xls / .csv</span>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
          </label>

          {columns.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">X 轴字段</label>
                  <select className="input" value={x} onChange={(e) => setX(e.target.value)}>
                    {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Y 轴字段（数值）</label>
                  <select className="input" value={y} onChange={(e) => setY(e.target.value)}>
                    {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">图表类型</label>
                  <select className="input" value={chartType} onChange={(e) => setChartType(e.target.value)}>
                    {CHART_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">图表标题（可选）</label>
                  <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：各方法准确率对比" />
                </div>
              </div>
              <button onClick={render} disabled={rendering} className="btn-primary w-full py-2.5">
                {rendering ? <><Refresh className="h-4 w-4 animate-spin" /> 生成中…</> : <><ChartBar className="h-4 w-4" /> 生成图表</>}
              </button>
            </div>
          )}
        </div>

        {/* 右侧：结果 + 插入 */}
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-ink">预览与插入</h3>
          {current ? (
            <div className="mt-4">
              <div className="flex items-center justify-center rounded-lg border border-slate-200 bg-white p-4">
                <img src={current.file_url} alt={current.title} className="max-h-[320px] max-w-full object-contain" />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <a href={current.file_url} download={`${current.title || 'chart'}.png`} className="btn-secondary text-xs">
                  <Download className="h-3.5 w-3.5" /> 下载 PNG
                </a>
              </div>
              <div className="mt-4 border-t border-slate-100 pt-4">
                <div className="mb-2 flex items-center gap-2">
                  <Layers className="h-4 w-4 text-accent" />
                  <span className="text-xs font-medium text-slate-600">插入到正在撰写的论文</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <select className="input" value={projectId} onChange={(e) => { setProjectId(e.target.value); setChapterId(''); }}>
                    <option value="">选择论文工作区</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                  </select>
                  <select className="input" value={chapterId} onChange={(e) => setChapterId(e.target.value)} disabled={!projectId}>
                    <option value="">选择章节</option>
                    {chapters.map((c) => <option key={c.id} value={c.id}>{c.chapter}</option>)}
                  </select>
                </div>
                <button onClick={insert} disabled={!projectId || !chapterId} className="btn-primary mt-3 w-full py-2 text-xs">
                  <Plus className="h-3.5 w-3.5" /> 插入到章节
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex h-[280px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 text-center">
              <ChartBar className="h-10 w-10 text-slate-300" />
              <p className="mt-3 text-sm text-slate-400">上传数据并生成图表后在此预览</p>
            </div>
          )}
        </div>
      </div>

      {/* 历史图表 */}
      {charts.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-3 text-sm font-semibold text-ink">我的图表 ({charts.length})</h3>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {charts.map((c) => (
              <div key={c.id} className="card overflow-hidden">
                <img src={c.file_url} alt={c.title} className="h-32 w-full object-cover" />
                <div className="flex items-center justify-between p-3">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-ink">{c.title}</div>
                    <div className="text-[10px] text-slate-400">{CHART_TYPES.find((t) => t.value === c.chart_type)?.label || c.chart_type}</div>
                  </div>
                  <button onClick={() => setCurrent(c)} className="text-xs text-accent hover:underline">预览</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Refresh, BookOpen } from '../../components/Icons.jsx';

export default function SupportCourses() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.supportListCourses();
      setCourses(Array.isArray(data.courses) ? data.courses : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">课程列表</h1>
          <p className="mt-1 text-sm text-slate-500">查看所有课程信息，了解服务内容与定价</p>
        </div>
        <button onClick={load} className="btn-ghost text-xs">
          <Refresh className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {loading ? (
        <div className="card mt-6 p-10 text-center text-sm text-slate-400">加载中…</div>
      ) : courses.length === 0 ? (
        <div className="card mt-6 p-10 text-center text-sm text-slate-400">暂无课程</div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <div key={c.id} className="card p-6">
              <div className="flex items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50 text-green-600">
                  <BookOpen className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-ink">{c.title}</h3>
                  {c.degree && <span className="text-xs text-slate-400">{c.degree}</span>}
                </div>
              </div>
              {c.description && (
                <p className="mt-3 text-sm leading-relaxed text-slate-500">{c.description}</p>
              )}
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
                <span className="rounded-md bg-slate-100 px-2 py-1">
                  {c.duration_text || '未设置时长'}
                </span>
                <span className="rounded-md bg-slate-100 px-2 py-1">
                  {c.validity_days ? `有效期 ${c.validity_days} 天` : '长期有效'}
                </span>
                <span className={`rounded-md px-2 py-1 ${c.is_active ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                  {c.is_active ? '已上架' : '已下架'}
                </span>
              </div>
              <div className="mt-4 border-t border-slate-100 pt-4">
                <span className="text-2xl font-bold text-accent">¥{Number(c.price).toFixed(2)}</span>
                <span className="ml-1 text-sm text-slate-400">起</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
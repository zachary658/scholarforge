/**
 * 骨架屏加载组件
 * 在内容加载时显示占位动画，提升用户体验
 */
export function Skeleton({ className = '', lines = 3, variant = 'text' }) {
  if (variant === 'card') {
    return (
      <div className={`animate-pulse rounded-xl border border-slate-200 bg-white p-6 ${className}`}>
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-lg bg-slate-200" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-2/3 rounded bg-slate-200" />
            <div className="h-3 w-1/2 rounded bg-slate-200" />
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} className="h-3 rounded bg-slate-200" style={{ width: `${80 - i * 15}%` }} />
          ))}
        </div>
      </div>
    );
  }
  if (variant === 'table-row') {
    return (
      <div className={`animate-pulse flex items-center gap-4 py-3 ${className}`}>
        <div className="h-9 w-9 rounded-lg bg-slate-200" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-1/3 rounded bg-slate-200" />
          <div className="h-3 w-1/4 rounded bg-slate-200" />
        </div>
      </div>
    );
  }
  // text variant
  return (
    <div className={`animate-pulse space-y-2 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-3 rounded bg-slate-200" style={{ width: i === lines - 1 ? '60%' : '100%' }} />
      ))}
    </div>
  );
}

export function PageSkeleton({ cards = 4 }) {
  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="animate-pulse">
        <div className="h-8 w-48 rounded bg-slate-200" />
        <div className="mt-2 h-4 w-72 rounded bg-slate-200" />
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: cards }, (_, i) => (
          <Skeleton key={i} variant="card" lines={2} />
        ))}
      </div>
    </div>
  );
}
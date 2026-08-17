import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-center">
      <h1 className="text-8xl font-bold text-slate-200">404</h1>
      <p className="mt-4 text-lg text-slate-600">页面不存在</p>
      <p className="mt-2 text-sm text-slate-400">您访问的页面可能已被移除或地址输入有误</p>
      <Link
        to="/"
        className="mt-8 inline-flex items-center rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700"
      >
        返回首页
      </Link>
    </div>
  );
}
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import Modal from './Modal.jsx';
import { BookOpen, Cpu, Layers, Pen } from './Icons.jsx';

export default function WorkModeGate() {
  const { user, workMode, chooseWorkMode } = useAuth();
  const navigate = useNavigate();

  // 管理员和客服有各自后台；这里只约束普通用户工作区。
  if (!user || user.is_admin || user.is_support || workMode) return null;

  const choose = (mode) => {
    chooseWorkMode(mode);
    const routes = { full: '/app/paper-workflow', other: '/app', coaching: '/app/courses', graduation: '/app/graduation' };
    navigate(routes[mode], { replace: true });
  };

  return (
    <Modal
      dismissible={false}
      label="选择使用方式"
      panelClassName="w-[680px] max-w-full"
    >
      <div className="border-b border-slate-100 px-6 py-5">
        <h2 className="text-lg font-semibold text-ink">今天想完成什么？</h2>
        <p className="mt-1.5 text-sm leading-6 text-slate-500">
          请先选择本次使用方式，选择后会直接进入对应工作区。退出登录后将重新选择。
        </p>
      </div>
      <div className="space-y-3 px-6 py-5">
        <button onClick={() => choose('full')} className="flex w-full items-start gap-3 rounded-xl border border-accent/30 bg-accent-50/50 p-4 text-left transition hover:bg-accent-50 focus:outline-none focus:ring-2 focus:ring-accent/40">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent text-white"><Layers className="h-5 w-5" /></div>
          <div>
            <div className="font-semibold text-ink">创建研究初稿项目</div>
            <div className="mt-1 text-sm leading-6 text-slate-500">真实文献检索 → 大纲确认 → 逐章辅助与确认 → 全文检查 → 输出带 AI 标识的 Word 初稿。</div>
          </div>
        </button>
        <button onClick={() => choose('other')} className="flex w-full items-start gap-3 rounded-xl border border-slate-200 p-4 text-left transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-accent/40">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Pen className="h-5 w-5" /></div>
          <div>
            <div className="font-semibold text-ink">使用其他工具</div>
            <div className="mt-1 text-sm leading-6 text-slate-500">进入工作台，自主选择开题报告、文献综述、润色翻译、查重优化等功能。</div>
          </div>
        </button>
        <button onClick={() => choose('coaching')} className="flex w-full items-start gap-3 rounded-xl border border-slate-200 p-4 text-left transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-accent/40">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><BookOpen className="h-5 w-5" /></div>
          <div>
            <div className="font-semibold text-ink">论文一对一指导</div>
            <div className="mt-1 text-sm leading-6 text-slate-500">填写论文方向与指导需求，获得报价，并在服务工作区持续查看进度和成果。</div>
          </div>
        </button>
        <button onClick={() => choose('graduation')} className="flex w-full items-start gap-3 rounded-xl border border-slate-200 p-4 text-left transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-accent/40">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600"><Cpu className="h-5 w-5" /></div>
          <div>
            <div className="font-semibold text-ink">毕业作品指导</div>
            <div className="mt-1 text-sm leading-6 text-slate-500">提交程序、设计、仿真或图纸指导需求，在线跟踪评估、辅导、验收和交付。</div>
          </div>
        </button>
      </div>
    </Modal>
  );
}

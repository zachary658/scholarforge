import { Link } from 'react-router-dom';
import { Wallet } from './Icons.jsx';

// 积分不足时的充值引导条
export default function RechargeBanner({ balance, needed }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-center gap-2 text-sm text-amber-800">
        <Wallet className="h-4 w-4 shrink-0" />
        <span>
          积分不足：本次约需 <strong>{needed}</strong> 积分，当前余额 <strong>{balance}</strong>
        </span>
      </div>
      <Link to="/app/points" className="btn-primary px-3 py-2 text-xs">
        去充值
      </Link>
    </div>
  );
}

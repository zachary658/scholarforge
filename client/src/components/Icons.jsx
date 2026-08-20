// 极简线条图标，匹配学术风设计系统
const base = (props) => ({
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  ...props,
});

export const Logo = ({ className = '' }) => (
  <svg viewBox="0 0 32 32" className={className} fill="none">
    <rect width="32" height="32" rx="7" fill="#4F46E5" />
    <path d="M9 22V10h2.4l3.2 8 3.2-8H20v12h-1.8v-8.6L15.2 21h-1.2l-3-7.6V22H9z" fill="white" />
  </svg>
);

export const Pen = (p) => (
  <svg {...base(p)}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

export const Sparkle = (p) => (
  <svg {...base(p)}>
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
  </svg>
);

export const Globe = (p) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
  </svg>
);

export const Book = (p) => (
  <svg {...base(p)}>
    <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v15H6.5A2.5 2.5 0 0 0 4 19.5Z" />
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20v5H6.5A2.5 2.5 0 0 1 4 19.5Z" />
  </svg>
);

export const Grid = (p) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

export const Crown = (p) => (
  <svg {...base(p)}>
    <path d="M3 7l4 4 5-6 5 6 4-4-2 12H5L3 7Z" />
    <path d="M5 19h14" />
  </svg>
);

export const Settings = (p) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
);

export const Check = (p) => (
  <svg {...base(p)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const Copy = (p) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);

export const Download = (p) => (
  <svg {...base(p)}>
    <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
  </svg>
);

export const Search = (p) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

export const Plus = (p) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const Trash = (p) => (
  <svg {...base(p)}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
  </svg>
);

export const ArrowRight = (p) => (
  <svg {...base(p)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const FileText = (p) => (
  <svg {...base(p)}>
    <path d="M14 3v5h5" />
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-4-5Z" />
    <path d="M8 13h8M8 17h8M8 9h2" />
  </svg>
);

export const Logout = (p) => (
  <svg {...base(p)}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </svg>
);

// 锁/密码图标
export const Lock = (p) => (
  <svg {...base(p)}>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

export const Refresh = (p) => (
  <svg {...base(p)}>
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
  </svg>
);

export const ChartBar = (p) => (
  <svg {...base(p)}>
    <path d="M3 3v18h18" />
    <rect x="7" y="11" width="3" height="6" />
    <rect x="12" y="7" width="3" height="10" />
    <rect x="17" y="13" width="3" height="4" />
  </svg>
);

export const Users = (p) => (
  <svg {...base(p)}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

export const Cpu = (p) => (
  <svg {...base(p)}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <rect x="9" y="9" width="6" height="6" />
    <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
  </svg>
);

export const Tag = (p) => (
  <svg {...base(p)}>
    <path d="M20.59 13.41 13.42 20.59a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
    <circle cx="7" cy="7" r="1.5" />
  </svg>
);

export const Sliders = (p) => (
  <svg {...base(p)}>
    <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
  </svg>
);

export const Activity = (p) => (
  <svg {...base(p)}>
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
);

export const Edit = (p) => (
  <svg {...base(p)}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
  </svg>
);

export const X = (p) => (
  <svg {...base(p)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const Shield = (p) => (
  <svg {...base(p)}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
  </svg>
);

export const Menu = (p) => (
  <svg {...base(p)}>
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

export const Receipt = (p) => (
  <svg {...base(p)}>
    <path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17l-3-2-2 2-2-2-2 2-3-2Z" />
    <path d="M9 8h6M9 12h6M9 16h3" />
  </svg>
);

export const Cart = (p) => (
  <svg {...base(p)}>
    <circle cx="9" cy="20" r="1.5" />
    <circle cx="18" cy="20" r="1.5" />
    <path d="M2 3h2.2l2 12.5a1.5 1.5 0 0 0 1.5 1.3h9.6a1.5 1.5 0 0 0 1.5-1.2L21 7H5.2" />
  </svg>
);

export const Layers = (p) => (
  <svg {...base(p)}>
    <path d="M12 2 2 7l10 5 10-5-10-5Z" />
    <path d="m2 12 10 5 10-5M2 17l10 5 10-5" />
  </svg>
);

export const Wallet = (p) => (
  <svg {...base(p)}>
    <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2" />
    <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H5a2 2 0 0 1-2-2Z" />
    <circle cx="16" cy="13" r="1.3" />
  </svg>
);

export const TrendingUp = (p) => (
  <svg {...base(p)}>
    <polyline points="3 17 9 11 13 15 21 7" />
    <polyline points="14 7 21 7 21 14" />
  </svg>
);

export const TrendingDown = (p) => (
  <svg {...base(p)}>
    <polyline points="3 7 9 13 13 9 21 17" />
    <polyline points="14 17 21 17 21 10" />
  </svg>
);

export const Coins = (p) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="5" />
    <path d="M14.5 4.5a5 5 0 0 1 0 7" />
    <path d="M18 3a8 8 0 0 1 0 10" />
    <path d="M8 11v6a4 4 0 0 0 4 4h2a5 5 0 0 0 5-5v-1" />
  </svg>
);

export const Gift = (p) => (
  <svg {...base(p)}>
    <path d="M20 12v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8" />
    <path d="M2 7h20v5H2zM12 22V7" />
    <path d="M12 7S11 3 8.5 3 6 5 8 7h4Zm0 0s1-4 3.5-4S18 5 16 7h-4Z" />
  </svg>
);

export const FileWord = (p) => (
  <svg {...base(p)}>
    <path d="M14 3v5h5" />
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-4-5Z" />
    <path d="M8 17l1.5-6 1.5 4 1.5-4 1.5 6" />
  </svg>
);

export const ChevronDown = (p) => (
  <svg {...base(p)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const AlertCircle = (p) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

export const Info = (p) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

// 拼写/语法检查图标
export const SpellCheck = (p) => (
  <svg {...base(p)}>
    <path d="M4 14l5-5 4 4 7-7" />
    <path d="M20 6v4h4" transform="rotate(180 12 8)" />
  </svg>
);

// 语言/翻译图标
export const Languages = (p) => (
  <svg {...base(p)}>
    <path d="M3 7h9M5 7v3a4 4 0 0 0 4 4M9 7v9" />
    <path d="M14 19l4-9 4 9M15.5 16h5" />
  </svg>
);

// 文件搜索图标
export const FileSearch = (p) => (
  <svg {...base(p)}>
    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
    <path d="M5 3h9l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <circle cx="11" cy="14" r="2.5" />
    <path d="M13 16l1.5 1.5" />
  </svg>
);

// 眼睛/查看图标
export const Eye = (p) => (
  <svg {...base(p)}>
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

// 过滤图标
export const Filter = (p) => (
  <svg {...base(p)}>
    <path d="M3 5h18l-7 9v6l-4-2v-4z" />
  </svg>
);

// 左箭头
export const ChevronLeft = (p) => (
  <svg {...base(p)}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

// 右箭头
export const ChevronRight = (p) => (
  <svg {...base(p)}>
    <path d="M9 18l6-6-6-6" />
  </svg>
);

export const Doc = FileWord;

// 大脑/AI记忆图标
export const Brain = (p) => (
  <svg {...base(p)}>
    <path d="M12 5a3 3 0 0 0-3 3 3 3 0 0 0-3 3 3 3 0 0 0 1.5 2.6A3 3 0 0 0 9 19a3 3 0 0 0 3-1.5A3 3 0 0 0 15 19a3 3 0 0 0 1.5-5.4A3 3 0 0 0 18 11a3 3 0 0 0-3-3 3 3 0 0 0-3-3Z" />
    <path d="M12 5v14M9.5 9.5h.01M14.5 9.5h.01" />
  </svg>
);

// 翻开的书图标
export const BookOpen = (p) => (
  <svg {...base(p)}>
    <path d="M12 7v14" />
    <path d="M3 5h6a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H3V5Z" />
    <path d="M21 5h-6a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h7V5Z" />
  </svg>
);

// 保存图标
export const Save = (p) => (
  <svg {...base(p)}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
    <path d="M17 21v-8H7v8M7 3v5h8" />
  </svg>
);

// 外部链接图标（用于文献可溯源链接）
export const ExternalLink = (p) => (
  <svg {...base(p)}>
    <path d="M15 3h6v6" />
    <path d="M10 14L21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </svg>
);

// 验证/溯源徽章图标
export const BadgeCheck = (p) => (
  <svg {...base(p)}>
    <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export const Wechat = (p) => (
  <svg {...base(p)}>
    <path d="M9.5 4C5.36 4 2 6.9 2 10.5c0 2 1.03 3.79 2.64 4.96L4 18l2.84-1.5c.84.22 1.72.34 2.66.34 4.14 0 7.5-2.9 7.5-6.34S13.64 4 9.5 4Z" />
    <path d="M22 14.5c0-2.6-2.47-4.7-5.5-4.7-.3 0-.6.02-.88.06" />
    <path d="M7.3 9.2h.01M11.7 9.2h.01M17.5 13.5h.01M20.5 13.5h.01" />
  </svg>
);

// 表格图标（数据套用/三线表展示用）
export const Table = (p) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18M3 14h18M9 4v16M15 4v16" />
  </svg>
);

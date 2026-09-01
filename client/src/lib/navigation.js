// 应用侧边栏导航配置（P1-5：六个客户心智一级入口）
// 顶层只展示 6 个入口：直接链接（含 to）或可展开分组（含 items），
// 展开后才展示该分类下的二级工具，避免侧栏堆砌约 20 个链接。
// icon 使用字符串键，由 Layout 的 NAV_ICONS 映射到实际图标组件，便于纯数据单元测试。
export const navGroups = [
  { key: 'dashboard', label: '工作台', to: '/app', icon: 'grid', end: true },
  { key: 'papers', label: '我的论文', to: '/app/projects', icon: 'layers' },
  {
    key: 'ai-tools',
    label: 'AI 工具',
    icon: 'pen',
    items: [
      { to: '/app/writing', label: '论文写作' },
      { to: '/app/proposal', label: '开题报告' },
      { to: '/app/literature-review', label: '文献综述' },
      { to: '/app/task-book', label: '任务书' },
      { to: '/app/defense', label: '答辩PPT+演讲稿' },
      { to: '/app/journal', label: '期刊论文' },
      { to: '/app/rewrite', label: '重复表达优化' },
      { to: '/app/ai-reduce', label: '表达自然度优化' },
      { to: '/app/polish', label: '润色翻译' },
    ],
  },
  {
    key: 'expert',
    label: '专家服务',
    icon: 'bookopen',
    items: [
      { to: '/app/courses', label: '论文1对1指导' },
      { to: '/app/graduation', label: '毕业作品指导' },
      { to: '/app/patent', label: '专利申请' },
      { to: '/app/publication', label: '期刊论文发表' },
    ],
  },
  {
    key: 'library',
    label: '文献与资料',
    icon: 'book',
    items: [
      { to: '/app/references', label: '文献管理' },
      { to: '/app/charts', label: '数据图表' },
      { to: '/app/templates', label: '格式模板' },
    ],
  },
  {
    key: 'delivery',
    label: '订单与交付',
    icon: 'receipt',
    items: [
      { to: '/app/tasks', label: '我的任务' },
      { to: '/app/docs', label: '我的文档' },
      { to: '/app/orders', label: '我的订单' },
    ],
  },
];

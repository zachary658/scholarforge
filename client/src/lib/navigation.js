// 应用侧边栏导航配置（P1-5：重构为 6 个一级入口）
// icon 使用字符串键，由 Layout 的 NAV_ICONS 映射到实际图标组件，
// 使本模块保持纯数据、可在 Node 环境下直接单元测试。
export const navGroups = [
  {
    label: '工作台',
    items: [
      { to: '/app', label: '概览', icon: 'grid', end: true },
    ],
  },
  {
    label: '论文工作区',
    items: [
      { to: '/app/projects', label: '论文工作区', icon: 'layers', end: false },
    ],
  },
  {
    label: 'AI 写作',
    items: [
      { to: '/app/writing', label: '论文写作', icon: 'pen', end: false },
      { to: '/app/proposal', label: '开题报告', icon: 'fileword', end: false },
      { to: '/app/literature-review', label: '文献综述', icon: 'book', end: false },
      { to: '/app/task-book', label: '任务书', icon: 'filetext', end: false },
      { to: '/app/defense', label: '答辩PPT+演讲稿', icon: 'fileword', end: false },
      { to: '/app/journal', label: '期刊论文', icon: 'filetext', end: false },
    ],
  },
  {
    label: '文本优化',
    items: [
      { to: '/app/rewrite', label: '重复表达优化', icon: 'activity', end: false },
      { to: '/app/ai-reduce', label: '表达自然度优化', icon: 'shield', end: false },
      { to: '/app/polish', label: '润色翻译', icon: 'globe', end: false },
    ],
  },
  {
    label: '1对1指导',
    items: [
      { to: '/app/courses', label: '论文1对1指导', icon: 'bookopen', end: false },
      { to: '/app/graduation', label: '毕业作品指导', icon: 'cpu', end: false },
      { to: '/app/patent', label: '专利申请', icon: 'shield', end: false },
      { to: '/app/publication', label: '期刊论文发表', icon: 'book', end: false },
    ],
  },
  {
    label: '资源与账户',
    items: [
      { to: '/app/references', label: '文献管理', icon: 'book', end: false },
      { to: '/app/charts', label: '数据图表', icon: 'chartbar', end: false },
      { to: '/app/templates', label: '格式模板', icon: 'layers', end: false },
      { to: '/app/tasks', label: '我的任务', icon: 'activity', end: false },
      { to: '/app/docs', label: '我的文档', icon: 'fileword', end: false },
      { to: '/app/orders', label: '我的订单', icon: 'receipt', end: false },
    ],
  },
];

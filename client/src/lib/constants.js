// 共享常量：避免各页面重复定义
export const FIELDS = [
  '计算机科学', '经济学', '管理学', '教育学', '医学',
  '法学', '文学', '心理学', '社会学', '工程学', '其他',
];

export const TOOL_LABEL = {
  writing: '论文写作', proposal: '开题报告', polish: '论文润色',
  translate: '中英翻译', grammar: '语法纠错', rewrite: '论文降重',
  ai_reduce: '降AI率',
  literature_review: '文献综述', task_book: '任务书',
  defense: '答辩PPT+演讲稿', journal: '期刊论文',
};

export const TOOL_ICON = {
  writing: 'Edit', proposal: 'FileText', polish: 'SpellCheck',
  translate: 'Languages', grammar: 'SpellCheck', rewrite: 'Copy',
  ai_reduce: 'Refresh',
  literature_review: 'Book', task_book: 'FileText',
  defense: 'FileWord', journal: 'FileText',
};

export const TOOL_COLOR = {
  writing: 'bg-blue-50 text-blue-600', proposal: 'bg-purple-50 text-purple-600',
  polish: 'bg-green-50 text-green-600', translate: 'bg-cyan-50 text-cyan-600',
  grammar: 'bg-amber-50 text-amber-600',
  rewrite: 'bg-indigo-50 text-indigo-600',
  ai_reduce: 'bg-teal-50 text-teal-600',
  literature_review: 'bg-violet-50 text-violet-600', task_book: 'bg-orange-50 text-orange-600',
  defense: 'bg-pink-50 text-pink-600', journal: 'bg-lime-50 text-lime-600',
};

// 订单状态（现金直付功能订单）
export const ORDER_STATUS_LABEL = {
  pending: '待支付',
  awaiting_quote: '待报价',
  quoted: '待支付',
  paid: '已支付',
  processing: '服务中',
  completed: '已完成',
  cancelled: '已取消',
};

export const ORDER_STATUS_CLASS = {
  pending: 'bg-amber-50 text-amber-600',
  awaiting_quote: 'bg-purple-50 text-purple-600',
  quoted: 'bg-amber-50 text-amber-600',
  paid: 'bg-green-50 text-green-600',
  processing: 'bg-blue-50 text-blue-600',
  completed: 'bg-emerald-50 text-emerald-600',
  cancelled: 'bg-slate-100 text-slate-500',
};

// 服务执行状态
export const SERVICE_STATUS_LABEL = {
  pending: '待处理',
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
};

// 支付方式
export const PAYMENT_METHOD_LABEL = {
  mock: '模拟',
  alipay: '支付宝',
  wechat: '微信支付',
  manual: '手动标记',
};

export const CHARGE_LABEL = {
  free_course: '课程额度', paid: '已付费',
  none: '免费', unlimited: '免费不限次',
};

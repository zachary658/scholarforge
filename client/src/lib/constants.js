// 共享常量：避免各页面重复定义
export const FIELDS = [
  '计算机科学', '经济学', '管理学', '教育学', '医学',
  '法学', '文学', '心理学', '社会学', '工程学', '其他',
];

export const TOOL_LABEL = {
  writing: '论文写作', proposal: '开题报告', polish: '论文润色',
  translate: '中英翻译', grammar: '语法纠错', rewrite: '重复表达优化',
  ai_reduce: '表达自然度优化',
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
  refunded: '已退款',
};

export const ORDER_STATUS_CLASS = {
  pending: 'bg-amber-50 text-amber-600',
  awaiting_quote: 'bg-purple-50 text-purple-600',
  quoted: 'bg-amber-50 text-amber-600',
  paid: 'bg-green-50 text-green-600',
  processing: 'bg-blue-50 text-blue-600',
  completed: 'bg-emerald-50 text-emerald-600',
  cancelled: 'bg-slate-100 text-slate-500',
  refunded: 'bg-slate-100 text-slate-500',
};

// 服务执行状态（统一状态机 service_status）
export const SERVICE_STATUS_LABEL = {
  pending: '待处理',
  queued: '已排队',
  processing: '处理中',
  awaiting_customer: '待客户补充',
  completed: '已完成',
  failed: '失败',
  after_sales: '售后中',
  closed: '已关闭',
};

// 客服状态（统一状态机 contact_status）
export const CONTACT_STATUS_LABEL = {
  pending: '待对接',
  contacted: '已对接',
  in_service: '服务中',
  completed: '已完成',
  closed: '已关闭',
};

// 支付方式
export const PAYMENT_METHOD_LABEL = {
  mock: '模拟',
  alipay: '支付宝',
  wechat: '微信支付',
  manual: '手动标记',
};

// 论文主流程阶段（工作区步骤导航，P1-4）
export const PAPER_STAGES = [
  { key: 'create', label: '创建论文', desc: '录入专业、题目、学历、截止时间' },
  { key: 'materials', label: '上传资料', desc: '上传参考材料与文献' },
  { key: 'outline', label: '生成大纲', desc: '生成并确认结构化大纲' },
  { key: 'literature', label: '文献综述', desc: '梳理文献综述' },
  { key: 'writing', label: '正文与图表', desc: '撰写正文与数据图表' },
  { key: 'review', label: '全文审校', desc: '润色、优化与审校' },
  { key: 'defense', label: '答辩材料', desc: '答辩 PPT 与演讲稿' },
  { key: 'export', label: '导出交付', desc: '按模板导出 Word 交付' },
];

export const CHARGE_LABEL = {
  free_course: '课程额度', paid: '已付费',
  none: '免费', unlimited: '免费不限次',
};

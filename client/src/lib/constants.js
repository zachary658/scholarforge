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

export const CHARGE_LABEL = {
  free_signup: '注册赠送', free_course: '课程额度', paid: '已付费',
  none: '免费', unlimited: '免费不限次', points: '积分消耗',
};
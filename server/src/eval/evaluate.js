// AI 输出质量评测集（P1-9）
// ----------------------------------------------------------------------------
// 目的：自动化测试只能证明「接口能运行」，不能证明论文结果可靠。本评测集用一组固定
// 语料 + 确定性结构检查器，对 AI 输出做质量回归，避免仅依赖接口级测试。
//
// 说明：
//   - 默认在「内置模板引擎」（未配置真实 AI 时的确定性回退）下运行，可在 CI 中稳定复现；
//   - 结构/格式类检查（占位符残留、乱码、章节完整性、字数下限）可在内置模式下确定性验证；
//   - 引用真实性 / 作者年份 DOI 匹配 / 是否编造实验数据 等「事实性」检查，只有接入真实
//     AI + 检索管线（真实文献列表）才能可靠评估，本评测集已将这些列为 real-ai-only 检查，
//     待具备真实 AI Key 后启用（见下方 REAL_AI_CHECKS）。
// ----------------------------------------------------------------------------
import { runAI } from '../ai-service.js';

// 固定评测语料：每个用例给出工具、参数与预期结构约束
export const EVAL_CORPUS = [
  {
    id: 'literature_review_zh',
    tool: 'literature_review',
    params: { topic: '深度学习在医学影像分割中的应用', field: '计算机科学', keywords: '深度学习,医学影像,分割', years: '近5年' },
    minLength: 400,
    sections: ['引言', '主题分类', '研究述评', '研究展望', '参考文献'],
    minHeadings: 4,
  },
  {
    id: 'task_book_zh',
    tool: 'task_book',
    params: { topic: '基于深度学习的医学影像分割方法研究', student_name: '张三', student_id: '20240101', field: '计算机科学', advisor: '李老师' },
    minLength: 300,
    sections: ['课题背景', '研究内容', '研究方法', '进度安排', '参考文献'],
    minHeadings: 4,
  },
  {
    id: 'journal_zh',
    tool: 'journal',
    params: { topic: '基于深度学习的医学影像分割方法研究', field: '计算机科学', research_content: '改进 U-Net 分割精度', method: '实验对比', journal_type: '核心期刊' },
    minLength: 400,
    sections: ['摘要', 'Abstract', '引言', '研究方法', '结论'],
    minHeadings: 4,
  },
  {
    id: 'defense_zh',
    tool: 'defense',
    params: { topic: '基于深度学习的医学影像分割方法研究', field: '计算机科学', research_content: '改进 U-Net 分割精度', innovation: '多尺度注意力', duration: 10 },
    minLength: 300,
    sections: ['封面', '研究背景', '研究方法', '演讲稿'],
    minHeadings: 4,
  },
  {
    id: 'proposal_zh',
    tool: 'proposal',
    params: { topic: '基于深度学习的医学影像分割方法研究', field: '计算机科学', direction: '计算机视觉', keywords: '深度学习,分割', objective: '提升分割精度', method: '实验', innovation: '注意力机制' },
    minLength: 200,
    sections: [],
    minHeadings: 0,
  },
  {
    id: 'polish_zh',
    tool: 'polish',
    params: { text: '深度学习在医学影像分割领域取得了显著的进展，近年来受到广泛关注。' },
    minLength: 5,
    sections: [],
    minHeadings: 0,
  },
];

// 仅真实 AI 下可评估的事实性检查（记录在此，待真实 AI + 检索管线接入后启用）
export const REAL_AI_CHECKS = [
  'citations_exist: 引用的文献均来自检索返回的真实文献列表，不得编造作者/年份/DOI',
  'no_fabricated_data: 实验数据/性能指标来自真实 benchmark，不得凭空编造数值',
  'consistency: 同一输入多次生成的质量波动在可接受范围内（用相似度/结构一致性度量）',
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 结构质量检查器：返回 { pass, issues }
export function checkContent(content, spec = {}) {
  const text = typeof content === 'string' ? content : '';
  const issues = [];

  if (text.trim().length === 0) issues.push('输出为空');

  const minLength = spec.minLength || 1;
  if (text.length < minLength) issues.push(`输出过短（${text.length} < ${minLength}）`);

  // 乱码 / 代理对残留
  if (/\uFFFD/.test(text)) issues.push('存在乱码替换符（U+FFFD）');
  if (/[\uD800-\uDFFF]/.test(text)) issues.push('存在未配对的代理字符');

  // 未替换占位符残留
  if (/\[CITE:\d+\]/.test(text)) issues.push('存在未替换的引用占位符 [CITE:n]');
  if (/\[CHART:[^\]]+\]/.test(text)) issues.push('存在未替换的图表占位符 [CHART:...]');
  if (/\{\{[^}]+\}\}/.test(text)) issues.push('存在未替换的模板占位符 {{...}}');
  if (/<<<USER_CONTENT>>>/.test(text)) issues.push('存在未清理的数据分隔符 <<<USER_CONTENT>>>');

  // 章节完整性（关键词出现即可，兼容 ## 标题与 **加粗** 两种风格）
  for (const s of (spec.sections || [])) {
    if (!text.includes(s)) issues.push(`缺少章节要素：${s}`);
  }

  // Markdown 标题数量下限（结构完整性）
  const headingCount = (text.match(/^#{1,6}\s+/gm) || []).length;
  if ((spec.minHeadings || 0) > 0 && headingCount < spec.minHeadings) {
    issues.push(`章节标题不足（${headingCount} < ${spec.minHeadings}）`);
  }

  return { pass: issues.length === 0, issues };
}

// 运行整组评测：对每个语料调用 runAI（内置模式），返回结果汇总
export async function runEval() {
  const results = [];
  for (const c of EVAL_CORPUS) {
    try {
      const out = await runAI(c.tool, c.params);
      const check = checkContent(out.content, c);
      results.push({ id: c.id, tool: c.tool, usedRealAI: out.usedRealAI, pass: check.pass, issues: check.issues, sampleLen: (out.content || '').length });
    } catch (err) {
      results.push({ id: c.id, tool: c.tool, usedRealAI: false, pass: false, issues: [`执行异常：${err.message}`], sampleLen: 0 });
    }
  }
  return results;
}

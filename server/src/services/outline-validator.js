// 论文大纲语义校验器（阶段三升级核心）
import { outlineTextToStructure } from './paper-distillation.js';
// 解决方案指出的根因：大纲被识别成「开题报告结构」而非论文正文结构。
//
// 规则：
//  1. 一级章节必须是论文正文章节（绪论/理论基础/文献综述/研究设计/现状分析/原因机制/对策建议/结论展望/参考文献）。
//  2. 普通编号列表（如「1. 选题背景与意义」「2. 研究方法」独立成段）不得直接成为一级章节。
//  3. 禁止「总体说明」「大纲结构说明」「论文大纲」等作为正文章节。
//  4. 禁止重复「参考文献」章节。
//  5. 开题报告式一级章（选题背景与意义/研究内容/研究方法/研究进度安排/论文结构安排）降级为「第一章 绪论」的小节，而非独立章节。
//
// 导出：
//  - classifyChapter(rawName)        分类单章名
//  - validateThesisOutline(outline)  结构校验，返回 { valid, errors, warnings, proposalChapters, forbiddenChapters, duplicateRefs }
//  - fixOutline(outline)             自动修复（删除非法章 / 合并重复参考文献 / 开题报告式降级为绪论小节）
//  - parseAndValidateOutline(text)   文本 → 结构（复用 outlineTextToStructure）→ 校验/修复

// 「开题报告式」一级章特征词：作为一级章出现即视为不合格，应降级为绪论小节
const RESEARCH_PROPOSAL_CHAPTERS = [
  '选题背景', '研究背景与意义', '选题意义', '研究内容与问题提出', '研究内容',
  '研究方法', '研究思路与方法', '研究思路', '研究进度', '进度安排', '论文结构安排',
  '结构安排', '研究计划', '技术路线', '预期成果', '创新点说明', '可行性分析', '拟解决的关键问题',
];

// 绝对禁止作为正文章节的标题
const FORBIDDEN_AS_CHAPTER = [
  '总体说明', '大纲结构说明', '论文大纲', '大纲说明', '大纲', '说明', '论文结构安排', '结构说明',
];

// 论文正文章节关键词（命中视为合格一级章）
const THESIS_CHAPTER_KEYWORDS = [
  '绪论', '引言', '导论', '文献综述', '理论基础', '相关理论', '理论框架', '研究设计', '研究框架',
  '现状', '问题分析', '问题研究', '调查研究', '实证研究', '案例分析', '案例研究', '原因', '影响',
  '机制', '对策', '建议', '路径', '策略', '优化', '改进', '提升', '结论', '展望', '总结', '参考文献', '附录',
];

export function stripChapterNumber(name) {
  return String(name || '')
    .replace(/^第[一二三四五六七八九十\d]+章[\s、.．]*/, '')
    .replace(/^[\d]+[.．、\s]+/, '')
    .replace(/^[一二三四五六七八九十]+[、.．\s]+/, '')
    .replace(/^（[一二三四五六七八九十\d]+）[\s]*/, '')
    .trim();
}

export function classifyChapter(rawName) {
  const name = stripChapterNumber(rawName);
  for (const f of FORBIDDEN_AS_CHAPTER) {
    if (name === f || name.includes(f)) return { kind: 'forbidden', name, clean: name };
  }
  for (const p of RESEARCH_PROPOSAL_CHAPTERS) {
    if (name.includes(p) || p.includes(name)) return { kind: 'proposal', name, clean: name };
  }
  for (const k of THESIS_CHAPTER_KEYWORDS) {
    if (name.includes(k)) return { kind: 'thesis', name, clean: name };
  }
  return { kind: 'unknown', name, clean: name };
}

// 自动修复：返回合格论文结构
export function fixOutline(outline) {
  const src = Array.isArray(outline) ? outline : [];
  const chapters = [];
  let intro = null;
  let refCount = 0;
  const pushIntro = (title) => {
    if (!intro) {
      intro = { chapter: '第一章 绪论', sections: [] };
      chapters.push(intro);
    }
    if (title && !intro.sections.some((s) => s.title === title)) intro.sections.push({ title });
  };
  for (const ch of src) {
    const raw = ch.chapter || ch.title || '';
    if (!raw || !raw.trim()) continue;
    const cls = classifyChapter(raw);
    if (cls.kind === 'forbidden') continue; // 直接删除
    if (cls.kind === 'proposal') {
      pushIntro(cls.clean); // 降级为绪论小节
      continue;
    }
    if (cls.kind === 'thesis' && /参考文献|附录/.test(cls.clean)) {
      refCount += 1;
      if (refCount > 1) continue; // 参考文献只保留一个
    }
    chapters.push({ chapter: raw, sections: Array.isArray(ch.sections) ? ch.sections : [] });
  }
  if (chapters.length === 0) {
    chapters.push({ chapter: '第一章 绪论', sections: ['研究背景与意义', '国内外研究现状', '研究内容与方法'] });
  }
  return chapters;
}

// 结构合法性（与 projects 路由/章节服务的上限一致）
export function validateThesisOutlineStructure(outline) {
  const errors = [];
  if (!Array.isArray(outline) || outline.length === 0) {
    errors.push('大纲为空');
    return { errors, ok: false };
  }
  if (outline.length > 15) errors.push(`章节数超过上限（最多 15 章，当前 ${outline.length} 章）`);
  for (const ch of outline) {
    const raw = ch.chapter || ch.title;
    if (typeof raw !== 'string' || !raw.trim()) errors.push('存在缺少标题的章节');
  }
  return { errors, ok: errors.length === 0 };
}

export function validateThesisOutline(outline, { fix = false } = {}) {
  const structural = validateThesisOutlineStructure(outline);
  const proposalChapters = [];
  const forbiddenChapters = [];
  let duplicateRefs = 0;
  let refSeen = 0;
  let thesisCount = 0;

  for (const ch of outline || []) {
    const raw = ch.chapter || ch.title || '';
    if (!raw) continue;
    const cls = classifyChapter(raw);
    if (cls.kind === 'forbidden') forbiddenChapters.push(raw);
    if (cls.kind === 'proposal') proposalChapters.push(raw);
    if (cls.kind === 'thesis') {
      thesisCount += 1;
      if (/参考文献|附录/.test(cls.clean)) {
        refSeen += 1;
        if (refSeen > 1) duplicateRefs += 1;
      }
    }
  }

  const errors = [];
  if (!structural.ok) errors.push(...structural.errors);
  if (forbiddenChapters.length) errors.push(`存在非法章节（不得作为正文章节）：${forbiddenChapters.join('、')}`);
  if (thesisCount === 0) {
    errors.push('未识别到任何论文正文章节（绪论/理论基础/文献综述/研究设计/现状分析/对策建议/结论/参考文献等），当前大纲疑似「开题报告结构」');
  }
  if (duplicateRefs > 0) errors.push(`存在 ${duplicateRefs} 个重复的「参考文献」章节`);

  const warnings = [];
  if (proposalChapters.length) {
    warnings.push(`检测到开题报告式章节，建议作为「第一章 绪论」的小节：${proposalChapters.join('、')}`);
  }

  const valid = errors.length === 0;
  const result = {
    valid,
    errors,
    warnings,
    proposalChapters,
    forbiddenChapters,
    duplicateRefs,
    thesisCount,
    outline: fix && !valid ? fixOutline(outline) : outline,
  };
  return result;
}

// 文本 → 结构（复用 paper-distillation 的解析）→ 校验/修复
export function parseAndValidateOutline(text, { fix = false } = {}) {
  const outline = outlineTextToStructure(text);
  const result = validateThesisOutline(outline, { fix });
  return result;
}

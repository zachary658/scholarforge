// 完整论文工作流服务（阶段三升级核心）
// 建立显式状态机，串联：信息填写 → 真实文献检索 → 大纲(生成/校验/确认) → 逐章生成与确认 → 全文检查 → 输出 → 专家入口。
// 复用已有 chapter-service（分章节生成/订单校验/文献≥3 校验/单章重写）与 task-store（项目持久化）。
import db from '../db.js';
import { getProject, saveProjectOutline, saveProjectSources, confirmOutline } from './task-store.js';
import { validateThesisOutline, fixOutline, parseAndValidateOutline } from './outline-validator.js';
import { generateSingleChapter } from './chapter-service.js';
import { mergeChapters } from './chapter-service.js';
import { generateDocx } from './docx-generator.js';
import { isQuartoConfigured, exportDocument } from './quarto-exporter.js';
import { now } from '../utils.js';
import logger from '../logger.js';
import { transitionServiceToCompleted } from './order-state.js';

export const WORKFLOW_STATES = [
  'setup', 'researching', 'outline_review', 'chapter_generating', 'chapter_review', 'final_review', 'completed',
];

// 合法状态转换（防止前端跳过关键确认点）
const TRANSITIONS = {
  setup: ['researching'],
  researching: ['outline_review', 'researching'],
  outline_review: ['chapter_generating', 'outline_review'],
  chapter_generating: ['chapter_review', 'chapter_generating'],
  chapter_review: ['chapter_generating', 'final_review', 'chapter_review'],
  final_review: ['completed', 'chapter_review'],
  completed: ['chapter_review'],
};

export function canTransition(from, to) {
  if (from === to) return to === 'researching' || to === 'chapter_generating' || to === 'chapter_review';
  return (TRANSITIONS[from] || []).includes(to);
}

function safeParse(s) {
  try { return JSON.parse(s || 'null'); } catch { return null; }
}

function getChapters(projectId) {
  const row = db.prepare('SELECT chapters_json FROM projects WHERE id = ?').get(projectId);
  try { return JSON.parse(row?.chapters_json || '[]'); } catch { return []; }
}

function saveChaptersRaw(projectId, chapters) {
  db.prepare('UPDATE projects SET chapters_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(chapters), now(), projectId);
}

export function getWorkflowState(projectId, userId) {
  const p = getProject(projectId, userId);
  if (!p) return null;
  return {
    mode: p.workflow_mode || 'tool',
    state: p.workflow_state || 'setup',
    currentChapterIndex: p.current_chapter_index || 0,
    orderNo: p.workflow_order_no || null,
    outlineVersion: p.outline_version || 0,
    outlineConfirmedAt: p.outline_confirmed_at || null,
    finalCheck: safeParse(p.final_check_json),
    project: p,
  };
}

function setState(projectId, userId, state) {
  if (!canTransition(getWorkflowState(projectId, userId).state, state)) {
    throw new Error(`非法状态转换：${getWorkflowState(projectId, userId).state} → ${state}`);
  }
  db.prepare('UPDATE projects SET workflow_state = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(state, now(), projectId, userId);
  return getWorkflowState(projectId, userId);
}

// 创建「生成完整论文」工作流（写入模式 + 初始状态 + 论文元信息）
export function createFullPaperWorkflow(projectId, userId, meta = {}) {
  const p = getProject(projectId, userId);
  if (!p) throw new Error('工作区不存在');
  // 创建后直接进入「真实文献检索」阶段（信息填写即创建工作区，已包含标题/学科/学历）。
  // setup 仅作为「尚未创建完整论文工作流」的默认态；本函数把它推进到 researching。
  db.prepare('UPDATE projects SET workflow_mode = ?, workflow_state = ?, current_chapter_index = 0, updated_at = ? WHERE id = ? AND user_id = ?')
    .run('full', 'researching', now(), projectId, userId);

  const sets = [];
  const params = [];
  if (meta.title) { sets.push('title = ?'); params.push(meta.title); }
  if (meta.field !== undefined) { sets.push('field = ?'); params.push(meta.field || ''); }
  if (meta.degree !== undefined) { sets.push('degree = ?'); params.push(meta.degree || ''); }
  if (meta.description !== undefined) { sets.push('description = ?'); params.push(meta.description || ''); }
  if (meta.writingRequirements !== undefined) { sets.push('writing_requirements = ?'); params.push(meta.writingRequirements || ''); }
  if (sets.length) {
    sets.push('updated_at = ?');
    params.push(now(), projectId, userId);
    db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  }
  return getWorkflowState(projectId, userId);
}

// researching 阶段：确认/保存真实文献，校验可溯源文献数量，推进到 outline_review
export function confirmLiterature(projectId, userId, references) {
  const p = getProject(projectId, userId);
  if (!p) throw new Error('工作区不存在');
  const sources = p.sources || {};
  sources.references = Array.isArray(references) ? references : (sources.references || []);
  saveProjectSources(projectId, userId, sources);
  const verified = (sources.references || []).filter((r) => r && (r.source_url || r.doi || r.source_db));
  if (verified.length < 3) {
    const e = new Error(`真实可溯源文献不足（需≥3篇，当前 ${verified.length} 篇）。请先完成检索，不得补造参考文献。`);
    e.code = 'LITERATURE_INSUFFICIENT';
    throw e;
  }
  return setState(projectId, userId, 'outline_review');
}

// 保存并校验大纲（结构文本或结构化数组）。invalid 时抛出 OUTLINE_INVALID 并附带详情。
export function saveOutlineValidated(projectId, userId, outlineOrText, { fromText = false, autoFix = false } = {}) {
  let outline;
  let parsed = null;
  if (fromText) {
    parsed = parseAndValidateOutline(outlineOrText, { fix: false });
    outline = parsed.outline;
  } else {
    outline = outlineOrText;
    parsed = validateThesisOutline(outline, { fix: false });
  }
  if (!parsed.valid) {
    const e = new Error('大纲未通过论文结构校验，请修订后确认（开题报告式结构需改为论文正文章节）。');
    e.code = 'OUTLINE_INVALID';
    e.details = parsed;
    throw e;
  }
  if (autoFix && parsed.outline && parsed.outline !== outline) outline = parsed.outline;
  // 提升大纲版本，并清空旧确认（要求重新确认）
  db.prepare('UPDATE projects SET outline_version = outline_version + 1, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(now(), projectId, userId);
  saveProjectOutline(projectId, userId, outline);
  // 若尚处于「真实文献检索」态则进入大纲确认态；已进入则保持（避免非法自转换）
  const cur = getWorkflowState(projectId, userId).state;
  if (cur === 'researching') setState(projectId, userId, 'outline_review');
  return getProject(projectId, userId);
}

// 确认大纲（强校验：必须是论文结构，禁止开题报告式）
export function confirmOutlineValidated(projectId, userId) {
  const p = getProject(projectId, userId);
  if (!p) throw new Error('工作区不存在');
  const v = validateThesisOutline(p.outline || [], { fix: false });
  if (!v.valid) {
    const e = new Error('大纲未通过论文结构校验，无法进入正文生成。');
    e.code = 'OUTLINE_INVALID';
    e.details = v;
    throw e;
  }
  const np = confirmOutline(projectId, userId);
  return setState(projectId, userId, 'chapter_generating');
}

// 生成当前章节（单章），完成后若成功则进入 chapter_review
export async function generateCurrentChapter(userId, projectId, orderNo) {
  const wf = getWorkflowState(projectId, userId);
  if (wf.state !== 'chapter_generating' && wf.state !== 'chapter_review') {
    throw new Error('当前状态不允许生成章节（需在 chapter_generating/chapter_review）');
  }
  const idx = wf.currentChapterIndex;
  // 支付成功后的项目订单号持久化在项目中；后续章节/刷新后不再要求用户重复支付。
  const effectiveOrderNo = orderNo || wf.orderNo || null;
  const r = await generateSingleChapter(userId, projectId, idx, effectiveOrderNo);
  if (effectiveOrderNo && !wf.orderNo) {
    db.prepare('UPDATE projects SET workflow_order_no = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(effectiveOrderNo, now(), projectId, userId);
  }
  const chapters = getChapters(projectId);
  if (chapters[idx] && chapters[idx].status === 'done') {
    setState(projectId, userId, 'chapter_review');
  }
  return { ...r, workflow: getWorkflowState(projectId, userId) };
}

// 确认当前章节：标记 confirmed，推进 currentChapterIndex；若全部完成 → final_review
export function confirmChapter(userId, projectId) {
  const wf = getWorkflowState(projectId, userId);
  if (wf.state !== 'chapter_review') throw new Error('当前没有可确认的章节');
  const idx = wf.currentChapterIndex;
  const chapters = getChapters(projectId);
  if (!chapters[idx]) throw new Error('章节不存在');
  if (chapters[idx].status !== 'done') throw new Error('该章节尚未生成完成，无法确认');
  chapters[idx] = { ...chapters[idx], confirmed: true, confirmed_at: now() };
  saveChaptersRaw(projectId, chapters);

  const total = (wf.project.outline || []).length;
  if (idx + 1 >= total) {
    return setState(projectId, userId, 'final_review');
  }
  db.prepare('UPDATE projects SET current_chapter_index = ?, workflow_state = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(idx + 1, 'chapter_generating', now(), projectId, userId);
  return getWorkflowState(projectId, userId);
}

// 返回上一章（调整大纲或重写）
export function backToChapter(userId, projectId, index) {
  const wf = getWorkflowState(projectId, userId);
  if (wf.state === 'completed' || wf.state === 'final_review' || wf.state === 'chapter_review' || wf.state === 'chapter_generating') {
    const total = (wf.project.outline || []).length;
    const idx = Math.max(0, Math.min(index ?? wf.currentChapterIndex - 1, total - 1));
    db.prepare('UPDATE projects SET current_chapter_index = ?, workflow_state = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(idx, 'chapter_generating', now(), projectId, userId);
    return getWorkflowState(projectId, userId);
  }
  throw new Error('当前状态不可返回上一步');
}

// 全文一致性检查
export function runFinalCheck(projectId, userId) {
  const p = getProject(projectId, userId);
  if (!p) throw new Error('工作区不存在');
  const chapters = p.chapters || [];
  const outline = p.outline || [];
  const checks = [];

  // 1. 章节编号连续 & 全部已确认/生成
  const notDone = chapters.filter((c) => c.status !== 'done');
  checks.push({
    key: 'chapter_complete',
    status: notDone.length === 0 ? 'pass' : 'fail',
    detail: notDone.length === 0 ? '全部章节已生成' : `有 ${notDone.length} 章尚未生成：${notDone.map((c) => c.chapter).join('、')}`,
  });

  // 2. 标题与大纲一致（章节数与大纲一致，且章名对应）
  const nameMatch = chapters.length === outline.length &&
    chapters.every((c, i) => (c.chapter || '').replace(/^第.章\s*/, '') === (outline[i]?.chapter || outline[i]?.title || '').replace(/^第.章\s*/, ''));
  checks.push({
    key: 'outline_consistency',
    status: nameMatch ? 'pass' : 'warn',
    detail: nameMatch ? '章节标题与大纲一致' : '部分章节标题与大纲不完全一致（可继续，但建议核对）',
  });

  // 3. 重复段落（跨章节正文去重）
  const bodies = chapters.map((c) => (c.content || '').trim()).filter(Boolean);
  let dupCount = 0;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      if (bodies[i].length > 200 && bodies[i] === bodies[j]) dupCount += 1;
    }
  }
  checks.push({
    key: 'duplicate_paragraphs',
    status: dupCount === 0 ? 'pass' : 'fail',
    detail: dupCount === 0 ? '未发现完全重复的章节正文' : `检测到 ${dupCount} 处重复章节正文`,
  });

  // 4. 图表编号连续（## 图1 / 表1 顺序）
  const figureNums = [];
  const tableNums = [];
  for (const b of bodies) {
    for (const m of b.matchAll(/图\s*(\d+)/g)) figureNums.push(Number(m[1]));
    for (const m of b.matchAll(/表\s*(\d+)/g)) tableNums.push(Number(m[1]));
  }
  const figOk = figureNums.length === 0 || figureNums.every((n, i) => i === 0 || n === figureNums[i - 1] + 1);
  const tabOk = tableNums.length === 0 || tableNums.every((n, i) => i === 0 || n === tableNums[i - 1] + 1);
  checks.push({
    key: 'figure_numbering',
    status: figOk && tabOk ? 'pass' : 'warn',
    detail: figOk && tabOk ? '图表编号连续' : '图表编号存在跳号（建议核对）',
  });

  // 5. 引文对应 & 无法核验引用
  const refs = (p.sources?.references || []).filter((r) => r && (r.source_url || r.doi || r.source_db));
  const cited = new Set();
  const unverifiable = [];
  const refPattern = /\[(\d+(?:[,-]\d+)*)\]/g;
  for (const b of bodies) {
    for (const m of b.matchAll(refPattern)) {
      for (const part of m[1].split(',')) {
        const n = Number(part.trim());
        if (Number.isFinite(n)) cited.add(n);
        else if (/\D/.test(part)) unverifiable.push(part);
      }
    }
  }
  const maxRef = refs.length;
  const outOfRange = [...cited].filter((n) => n < 1 || n > maxRef);
  checks.push({
    key: 'citation_range',
    status: outOfRange.length === 0 ? 'pass' : 'fail',
    detail: outOfRange.length === 0 ? `引文编号均在 1–${maxRef} 范围内` : `存在超出文献范围的引文编号：${outOfRange.join(', ')}`,
  });

  // 6. 未引用文献
  const uncited = Math.max(0, maxRef - cited.size);
  checks.push({
    key: 'uncited_references',
    status: uncited === 0 ? 'pass' : 'warn',
    detail: uncited === 0 ? '全部文献均被正文引用' : `有 ${uncited} 篇文献未被正文引用（建议补充引用或移除）`,
  });

  const failed = checks.filter((c) => c.status === 'fail');
  const result = {
    passed: failed.length === 0,
    generatedAt: now(),
    checks,
  };
  db.prepare('UPDATE projects SET final_check_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(result), now(), projectId);
  return result;
}

// 生成最终文档（复用 chapters 合并 + docx 生成）
export async function generateFinalDocument(projectId, userId, { template_id, format } = {}) {
  const wf = getWorkflowState(projectId, userId);
  if (!wf || wf.state !== 'final_review') throw new Error('当前尚未完成逐章确认，不能生成最终文档');
  const existingCheck = wf.finalCheck;
  if (!existingCheck || existingCheck.passed !== true) {
    throw new Error('请先运行全文一致性检查，并修复所有失败项后再输出最终文档');
  }
  const merged = mergeChapters(userId, projectId);
  let template = null;
  if (template_id) {
    template = db.prepare('SELECT * FROM templates WHERE id = ? AND (user_id = ? OR is_global = 1)').get(template_id, userId);
  }
  let doc = null;
  let quarto = null;
  if (format && isQuartoConfigured()) {
    const allowed = ['docx', 'pdf', 'latex', 'html', 'epub', 'pptx', 'odt'];
    if (!allowed.includes(format)) throw new Error(`不支持的导出格式: ${format}`);
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { writeFileSync } = await import('node:fs');
    const inputPath = join(tmpdir(), `sf-final-${projectId}-${Date.now()}.md`);
    const outputPath = join(tmpdir(), `sf-final-${projectId}-${Date.now()}.${format}`);
    writeFileSync(inputPath, merged.content, 'utf8');
    quarto = await exportDocument(inputPath, outputPath, { format });
  } else {
    doc = await generateDocx({
      title: merged.title,
      content: merged.content,
      feature: 'chapters',
      userId,
      projectId,
      template,
    });
  }
  // 项目套餐在最终文档成功生成后才结束；逐章阶段保持 processing 以便复用权益。
  const finalOrderNo = wf.orderNo;
  if (finalOrderNo) {
    const finalOrder = db.prepare('SELECT id FROM orders WHERE order_no = ? AND user_id = ?').get(finalOrderNo, userId);
    if (finalOrder) transitionServiceToCompleted(finalOrder.id, { reason: '完整论文最终文档交付' });
  }
  // 处于「全文检查」阶段时，导出即视为交付完成，推进到 completed
  let workflow = getWorkflowState(projectId, userId);
  if (workflow.state === 'final_review') {
    try { workflow = setState(projectId, userId, 'completed'); } catch { /* 状态非法则忽略，不影响导出 */ }
  }
  return { doc, quarto, content: merged.content, workflow };
}

// 专家咨询上下文（courses?projectId= 预填）
export function buildExpertContext(projectId, userId) {
  const p = getProject(projectId, userId);
  if (!p) return null;
  const chapters = p.chapters || [];
  const done = chapters.filter((c) => c.status === 'done').length;
  return {
    projectId: p.id,
    title: p.title || '',
    field: p.field || '',
    degree: p.degree || '',
    writingRequirements: p.writing_requirements || '',
    targetWords: (p.writing_requirements || '').match(/(\d{3,6})\s*(字|千字|万字)/)?.[0] || '',
    completion: `${done}/${chapters.length}`,
  };
}

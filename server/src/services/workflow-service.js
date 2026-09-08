// 完整论文工作流服务（阶段三升级核心）
// 建立显式状态机，串联：信息填写 → 真实文献检索 → 大纲(生成/校验/确认) → 逐章生成与确认 → 全文检查 → 输出 → 专家入口。
// 复用已有 chapter-service（分章节生成/订单校验/文献≥3 校验/单章重写）与 task-store（项目持久化）。
import db from '../db.js';
import { getProject, saveProjectOutline, saveProjectSources, confirmOutline } from './task-store.js';
import { validateThesisOutline, parseAndValidateOutline, stripChapterNumber } from './outline-validator.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSingleChapter, isGenerating } from './chapter-service.js';
import { mergeChapters } from './chapter-service.js';
import { generateDocx } from './docx-generator.js';
import { isQuartoConfigured, exportDocument } from './quarto-exporter.js';
import { now } from '../utils.js';
import { transitionServiceToCompleted } from './order-state.js';
import { inspectPaper, contentVersion } from './final-quality.js';
import { resolveWritingReferences } from './reference-verification.js';
import { hasReferenceProof } from './reference-proof.js';
import { runAI } from '../ai-service.js';
import { getRoleModel } from './orchestrator.js';
import { isForeignReference, supplementVerifiedReferences } from './reference-policy.js';
import { parseReviewVerdict } from './review-chain.js';

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
  db.prepare('UPDATE projects SET chapters_json = ?, final_check_json = NULL, updated_at = ? WHERE id = ?').run(JSON.stringify(chapters), now(), projectId);
}

export function reopenResearch(projectId, userId) {
  const p = getProject(projectId, userId);
  if (!p || p.workflow_mode !== 'full') throw new Error('完整论文工作流不存在');
  if (isGenerating(projectId)) throw new Error('请等待当前章节生成完成');
  saveChaptersRaw(projectId, (p.chapters || []).map(c => ({ ...c, confirmed: false, confirmed_at: null })));
  db.prepare("UPDATE projects SET workflow_state = 'researching', outline_confirmed_at = NULL, current_chapter_index = 0 WHERE id = ? AND user_id = ?").run(projectId, userId);
  return getWorkflowState(projectId, userId);
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
  if (p.workflow_mode === 'full' && p.workflow_state && p.workflow_state !== 'setup') return getWorkflowState(projectId, userId);
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
export async function confirmLiterature(projectId, userId, references) {
  const p = getProject(projectId, userId);
  if (!p) throw new Error('工作区不存在');
  const sources = p.sources || {};
  if (p.workflow_mode !== 'full' || p.workflow_state !== 'researching') throw new Error('请在文献确认阶段操作');
  const candidate = Array.isArray(references) ? references : (sources.references || []);
  const verified = await resolveWritingReferences(candidate);
  const supplement = await supplementVerifiedReferences({ ...p, sources: { ...sources, references: verified } });
  if (!supplement.complete) {
    const e = new Error(`真实文献尚未达到生成标准（需≥10篇且至少3篇外文；当前 ${supplement.total} 篇、外文 ${supplement.foreign} 篇）。请重试检索，不得补造参考文献。`);
    e.code = 'LITERATURE_INSUFFICIENT';
    e.details = { total: supplement.total, foreign: supplement.foreign, errors: supplement.errors };
    throw e;
  }
  if (getProject(projectId, userId)?.workflow_state !== 'researching') throw new Error('流程已变更，请刷新后重试');
  sources.references = supplement.references;
  saveProjectSources(projectId, userId, sources);
  return setState(projectId, userId, 'outline_review');
}

// 保存并校验大纲（结构文本或结构化数组）。invalid 时抛出 OUTLINE_INVALID 并附带详情。
export function saveOutlineValidated(projectId, userId, outlineOrText, { fromText = false, autoFix = false } = {}) {
  const project = getProject(projectId, userId);
  if (!project) throw new Error('工作区不存在');
  if (project.workflow_mode === 'full' && project.workflow_state !== 'outline_review') throw new Error('请在大纲确认阶段修改结构');
  let outline;
  let parsed = null;
  if (fromText) {
    parsed = parseAndValidateOutline(outlineOrText, { fix: false });
    outline = parsed.outline;
  } else {
    outline = outlineOrText;
    parsed = validateThesisOutline(outline, { fix: false });
  }
  // Bibliography is compiled from verified records at export, never authored as a chapter.
  if (Array.isArray(outline)) {
    outline = outline.filter(ch => !/^(参考文献|references|bibliography)$/i.test(stripChapterNumber(ch?.chapter || ch?.title)));
    parsed = validateThesisOutline(outline, { fix: false });
  }
  if (!parsed.valid) {
    const e = new Error('大纲未通过论文结构校验，请修订后确认（开题报告式结构需改为论文正文章节）。');
    e.code = 'OUTLINE_INVALID';
    e.details = parsed;
    throw e;
  }
  if (autoFix && parsed.outline && parsed.outline !== outline) outline = parsed.outline;
  if (project.chapters?.length && JSON.stringify(outline) !== JSON.stringify(project.outline)) throw new Error('已生成正文的项目暂不支持更换大纲结构，请新建项目以保留已有内容');
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
  const confirmedReferences = p.sources?.references || [];
  if (p.workflow_mode === 'full' && (confirmedReferences.length < 10
    || confirmedReferences.filter(isForeignReference).length < 3
    || !confirmedReferences.every(hasReferenceProof))) {
    throw new Error('请先确认不少于10篇、其中至少3篇外文的可回查真实文献');
  }
  if (!v.valid) {
    const e = new Error('大纲未通过论文结构校验，无法进入正文生成。');
    e.code = 'OUTLINE_INVALID';
    e.details = v;
    throw e;
  }
  if (p.workflow_mode !== 'full') { confirmOutline(projectId, userId); return getWorkflowState(projectId, userId); }
  if (p.workflow_state !== 'outline_review') throw new Error('当前阶段不能确认大纲');
  confirmOutline(projectId, userId);
  return setState(projectId, userId, 'chapter_generating');
}

// 生成当前章节（单章），完成后若成功则进入 chapter_review
export async function generateCurrentChapter(userId, projectId, orderNo) {
  const wf = getWorkflowState(projectId, userId);
  if (!wf || wf.mode !== 'full') throw new Error('完整论文工作流不存在');
  if (wf.state !== 'chapter_generating' && wf.state !== 'chapter_review') {
    throw new Error('当前状态不允许生成章节（需在 chapter_generating/chapter_review）');
  }
  const idx = wf.currentChapterIndex;
  if (orderNo && wf.orderNo && orderNo !== wf.orderNo) throw new Error('请使用本项目已绑定的套餐订单');
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
export function confirmChapter(userId, projectId, { content, chapterId } = {}) {
  const wf = getWorkflowState(projectId, userId);
  if (!wf || wf.state !== 'chapter_review' || isGenerating(projectId)) throw new Error('当前没有可确认的章节或正在生成');
  const idx = wf.currentChapterIndex;
  const chapters = getChapters(projectId);
  if (!chapters[idx]) throw new Error('章节不存在');
  if (chapters[idx].status !== 'done') throw new Error('该章节尚未生成完成，无法确认');
  if (chapterId && chapterId !== chapters[idx].id) throw new Error('章节已切换，请刷新后确认');
  if (chapters.slice(0, idx).some(c => !c.confirmed)) throw new Error('请按顺序确认前面的章节');
  if (content !== undefined && (typeof content !== 'string' || content.length > 200000)) throw new Error('章节正文格式不正确或过长');
  if (content !== undefined && content !== chapters[idx].content) {
    for (let i = idx + 1; i < chapters.length; i++) chapters[i] = { ...chapters[i], confirmed: false, confirmed_at: null };
  }
  if (content !== undefined) chapters[idx].content = String(content);
  if (!String(chapters[idx].content || '').trim()) throw new Error('请先填写正文再确认');
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
  if (!wf || isGenerating(projectId)) throw new Error('工作流不存在或正在生成');
  if (wf.state === 'completed' || wf.state === 'final_review' || wf.state === 'chapter_review' || wf.state === 'chapter_generating') {
    const total = (wf.project.outline || []).length;
    const idx = Math.max(0, Math.min(index ?? wf.currentChapterIndex - 1, total - 1));
    if (!Number.isInteger(idx) || idx > wf.currentChapterIndex) throw new Error('请按顺序操作章节');
    const chapters = getChapters(projectId);
    for (let i = idx; i < chapters.length; i++) chapters[i] = { ...chapters[i], confirmed: false, confirmed_at: null };
    saveChaptersRaw(projectId, chapters);
    db.prepare('UPDATE projects SET current_chapter_index = ?, workflow_state = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(idx, chapters[idx]?.status === 'done' ? 'chapter_review' : 'chapter_generating', now(), projectId, userId);
    return getWorkflowState(projectId, userId);
  }
  throw new Error('当前状态不可返回上一步');
}

// 全文一致性检查
export function runFinalCheck(projectId, userId) {
  const p = getProject(projectId, userId);
  if (!p) throw new Error('工作区不存在');
  const result = inspectPaper(p);
  if (!(p.sources?.references || []).every(hasReferenceProof)) {
    result.passed = false;
    result.checks.push({
      key: 'reference_proof',
      status: 'fail',
      detail: '文献记录发生变化或尚未经过服务端核验。',
      locations: [{ scope: 'references', excerpt: '至少一条文献缺少有效的服务端核验凭据。' }],
      suggestion: '请返回真实文献检索步骤重新核验；自动纠错不会伪造核验结果。',
      autoFixable: false,
    });
    result.summary = {
      ...(result.summary || {}),
      failed: (result.summary?.failed || 0) + 1,
    };
  }
  db.prepare('UPDATE projects SET final_check_json = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(JSON.stringify(result), now(), projectId, userId);
  return result;
}

const finalChecksInFlight = new Map();

export async function runFinalCheckWithAnalysis(projectId, userId, { runner = runAI, searcher } = {}) {
  const key = `${userId}:${projectId}`;
  if (finalChecksInFlight.has(key)) return finalChecksInFlight.get(key);
  const pending = analyzeFinalCheck(projectId, userId, { runner, searcher });
  finalChecksInFlight.set(key, pending);
  try { return await pending; } finally { finalChecksInFlight.delete(key); }
}

async function analyzeFinalCheck(projectId, userId, { runner, searcher }) {
  let project = getProject(projectId, userId);
  if (!project) throw new Error('工作区不存在');
  if (project.workflow_mode !== 'full' || project.workflow_state !== 'final_review') throw new Error('请在全文一致性检查阶段运行检查');

  const supplement = await supplementVerifiedReferences(project, { searcher });
  if (supplement.added > 0 || supplement.references.length !== (project.sources?.references || []).length) {
    saveProjectSources(projectId, userId, { ...(project.sources || {}), references: supplement.references }, { allowVerifiedAppend: true });
    project = getProject(projectId, userId);
  }

  const result = runFinalCheck(projectId, userId);
  const fullText = (project.chapters || []).map((chapter) => `# ${chapter.chapter || ''}\n\n${chapter.content || ''}`).join('\n\n');
  const reviewerModel = getRoleModel({ field: project.field, task: 'final_logic_review', role: 'reviewer' });
  let logicCheck;
  if (!reviewerModel && runner === runAI) {
    logicCheck = {
      key: 'logic_coherence', status: 'fail', autoFixable: false,
      detail: '尚未配置可用于全文逻辑复核的审校模型。',
      locations: [{ scope: 'paper', excerpt: '无法完成跨章节论点衔接、前后矛盾和结论呼应检查。' }],
      suggestion: '请在模型配置中启用“逻辑审校”角色后重新检查。',
    };
  } else {
    try {
      const review = await runner('review', {
        content: fullText,
        references: project.sources?.references || [],
        context: '重点检查：章节之间是否自然衔接、概念与研究对象是否前后一致、方法能否支撑结论、结论是否回应研究问题。若存在实质问题，审校结论必须写“整体评价：需修改”，并列出章节位置；若无实质问题写“整体评价：通过”。',
      }, null, reviewerModel);
      const available = Boolean(review?.usedRealAI && review?.content);
      const declaredPass = /整体评价[：:]\s*通过/.test(review?.content || '');
      const passed = available && declaredPass && parseReviewVerdict(review.content) === 'pass';
      const reportText = String(review?.content || '');
      const mentionedChapters = passed ? [] : (project.chapters || []).flatMap((chapter, chapterIndex) => {
        const title = String(chapter?.chapter || '').trim();
        const shortTitle = title.replace(/^第?[一二三四五六七八九十百\d]+章\s*/, '');
        return title && (reportText.includes(title) || (shortTitle.length >= 2 && reportText.includes(shortTitle)))
          ? [{ scope: 'chapter', chapterIndex, chapterId: chapter.id || null, chapter: title, excerpt: reportText.replace(/\s+/g, ' ').slice(0, 600) }]
          : [];
      });
      logicCheck = {
        key: 'logic_coherence', status: passed ? 'pass' : 'fail', autoFixable: available && !passed,
        detail: passed ? 'AI 全文逻辑复核通过。' : available ? 'AI 全文逻辑复核发现需要修改的问题。' : '审校模型未返回有效的全文逻辑复核结果。',
        locations: passed ? [] : (mentionedChapters.length ? mentionedChapters : [{ scope: 'paper', excerpt: reportText.replace(/\s+/g, ' ').slice(0, 600) || '请检查模型配置后重试。' }]),
        suggestion: available ? '可一键按审校报告补充或调整相关章节，然后自动复检。' : '请检查审校模型 API 配置后重新运行检查。',
        report: available ? review.content : '',
      };
    } catch (error) {
      logicCheck = {
        key: 'logic_coherence', status: 'fail', autoFixable: false,
        detail: '全文逻辑复核暂时失败。',
        locations: [{ scope: 'paper', excerpt: error.message }],
        suggestion: '请检查审校模型或网络连接后重试；系统不会在未复核时放行。',
      };
    }
  }

  result.checks = [...result.checks.filter((item) => item.key !== 'logic_coherence'), logicCheck];
  result.passed = result.checks.every((item) => item.status !== 'fail');
  result.summary = {
    failed: result.checks.filter((item) => item.status === 'fail').length,
    warnings: result.checks.filter((item) => item.status === 'warn').length,
    autoFixable: result.checks.filter((item) => item.status === 'fail' && item.autoFixable).length,
  };
  result.referenceSupplement = {
    added: supplement.added,
    total: supplement.total,
    foreign: supplement.foreign,
    complete: supplement.complete,
    errors: supplement.errors,
  };
  db.prepare('UPDATE projects SET final_check_json = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(JSON.stringify(result), now(), projectId, userId);
  return result;
}

function stripChapterBibliography(content) {
  const pattern = /(?:^|\n)\s{0,3}#{0,6}\s*(?:(?:主要)?参考文献|references|bibliography)\s*[:：]?\s*(?:\n|$)[\s\S]*$/i;
  return String(content || '').replace(pattern, '').trimEnd();
}

function removeLaterDuplicateParagraphs(chapters) {
  const seen = new Set();
  return chapters.map((chapter) => {
    const parts = String(chapter?.content || '').split(/\n\s*\n/);
    const kept = parts.filter((paragraph) => {
      const normalized = paragraph.replace(/\s+/g, ' ').trim();
      if (normalized.length <= 200) return true;
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
    return { ...chapter, content: kept.join('\n\n') };
  });
}

function correctionLooksSafe(original, corrected, { allowExpansion = false } = {}) {
  const before = String(original || '').trim();
  const after = String(corrected || '').trim();
  const maxRatio = allowExpansion ? 4 : 1.6;
  if (!before || !after || after.length < Math.max(120, before.length * 0.55) || after.length > before.length * maxRatio) return false;
  if (allowExpansion && after.length <= before.length) return false;
  const beforeHeadings = (before.match(/^#{1,6}\s+/gm) || []).length;
  const afterHeadings = (after.match(/^#{1,6}\s+/gm) || []).length;
  return beforeHeadings === 0 || afterHeadings >= Math.floor(beforeHeadings * 0.6);
}

function affectedChapterIndexes(checkResult, chapters) {
  const semanticKeys = new Set(['citation_range', 'citation_present', 'unresolved_placeholders', 'word_count', 'section_structure', 'logic_coherence']);
  const indexes = new Set();
  for (const item of checkResult.checks || []) {
    if (item.status !== 'fail' || !semanticKeys.has(item.key)) continue;
    const locations = item.locations || [];
    for (const location of locations) {
      if (Number.isInteger(location.chapterIndex)) indexes.add(location.chapterIndex);
      if (location.scope === 'paper') {
        chapters.forEach((chapter, index) => {
          if (String(chapter?.content || '').trim()) indexes.add(index);
        });
      }
    }
  }
  return [...indexes].sort((a, b) => a - b);
}

const finalFixesInFlight = new Map();

export async function autoFixFinalCheck(projectId, userId, { runner = runAI } = {}) {
  const key = `${userId}:${projectId}`;
  if (finalFixesInFlight.has(key)) return finalFixesInFlight.get(key);
  const pending = autoFixFinalCheckInternal(projectId, userId, runner);
  finalFixesInFlight.set(key, pending);
  try { return await pending; } finally { finalFixesInFlight.delete(key); }
}

async function autoFixFinalCheckInternal(projectId, userId, runner) {
  const wf = getWorkflowState(projectId, userId);
  if (!wf || wf.mode !== 'full' || wf.state !== 'final_review') throw new Error('请在全文一致性检查阶段使用一键纠错');
  if (isGenerating(projectId)) throw new Error('请等待当前生成任务完成');

  const cachedCheck = wf.finalCheck?.contentVersion === contentVersion(wf.project) ? wf.finalCheck : null;
  const initialCheck = cachedCheck || await runFinalCheckWithAnalysis(projectId, userId, { runner });
  if (initialCheck.passed) return { check: initialCheck, workflow: getWorkflowState(projectId, userId), fixes: [], unresolved: [], nextAction: 'final_document' };

  const refreshedWorkflow = getWorkflowState(projectId, userId);

  const sourceRow = db.prepare('SELECT chapters_json FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId);
  if (!sourceRow) throw new Error('工作区不存在');
  const originalJson = sourceRow.chapters_json || '[]';
  let chapters;
  try { chapters = JSON.parse(originalJson); } catch { chapters = []; }
  chapters = chapters.map((chapter) => ({ ...chapter }));
  const fixes = [];
  const unresolved = [];
  const outline = refreshedWorkflow.project.outline || [];

  const outlineCheck = initialCheck.checks.find((item) => item.key === 'outline_consistency' && item.status === 'fail');
  if (outlineCheck && chapters.length === outline.length) {
    let changed = 0;
    chapters = chapters.map((chapter, index) => {
      const expected = outline[index]?.chapter;
      if (!expected || chapter.chapter === expected) return chapter;
      changed += 1;
      return { ...chapter, chapter: expected };
    });
    if (changed) fixes.push({ key: 'outline_consistency', detail: `已对齐 ${changed} 个章节标题。` });
  }

  const beforeBibliography = JSON.stringify(chapters);
  chapters = chapters.map((chapter) => ({ ...chapter, content: stripChapterBibliography(chapter.content) }));
  if (JSON.stringify(chapters) !== beforeBibliography) fixes.push({ key: 'bibliography_owned', detail: '已删除章节内自行生成的参考文献列表。' });

  const beforeDuplicates = JSON.stringify(chapters);
  chapters = removeLaterDuplicateParagraphs(chapters);
  if (JSON.stringify(chapters) !== beforeDuplicates) fixes.push({ key: 'duplicate_paragraphs', detail: '已移除后续完全重复的大段文字。' });

  const semanticIndexes = affectedChapterIndexes(initialCheck, chapters);
  for (const index of semanticIndexes) {
    const chapter = chapters[index];
    if (!chapter || !String(chapter.content || '').trim()) continue;
    const findings = (initialCheck.checks || [])
      .filter((item) => item.status === 'fail' && ['citation_range', 'citation_present', 'unresolved_placeholders', 'word_count', 'section_structure', 'logic_coherence'].includes(item.key))
      .filter((item) => (item.locations || []).some((location) => location.scope === 'paper' || location.chapterIndex === index))
      .map((item) => `${item.detail} ${item.suggestion || ''}`)
      .join('\n');
    let wordLocation = (initialCheck.checks.find((item) => item.key === 'word_count')?.locations || [])
      .find((location) => location.scope === 'paper' || location.chapterIndex === index);
    if (wordLocation?.scope === 'paper' && wordLocation.targetWords) {
      wordLocation = { ...wordLocation, targetWords: Math.ceil(wordLocation.targetWords / Math.max(1, chapters.length)) };
    }
    const allowExpansion = Boolean(wordLocation);
    const model = getRoleModel({ field: refreshedWorkflow.project.field, task: 'final_autofix', chapter, role: 'writer' });
    try {
      const result = await runner('revise', {
        topic: refreshedWorkflow.project.title,
        field: refreshedWorkflow.project.field,
        content: chapter.content,
        review: '只修复本章的一致性检查失败项，保持章节结构、论点和篇幅。',
        findings,
        references: refreshedWorkflow.project.sources?.references || [],
        benchmarks: refreshedWorkflow.project.sources?.benchmarks || [],
        dataTables: refreshedWorkflow.project.sources?.tables || [],
        context: `引用只能使用真实参考文献列表中的数字编号 [1]、[2] 等；不得输出 [CITE:n]、待补充、TODO 或自建参考文献表；无证据支持的具体事实或数值应删除或改为审慎表述。${wordLocation?.targetWords ? `本章应扩充到约 ${wordLocation.targetWords} 字，必须增加有证据的分析而非重复凑字。` : ''}只输出本章修订后的完整正文。`,
      }, null, model);
      if (!result?.usedRealAI || !correctionLooksSafe(chapter.content, result.content, { allowExpansion })) {
        unresolved.push({ chapterIndex: index, chapter: chapter.chapter, detail: result?.usedRealAI ? '模型修订稿结构或篇幅异常，已保留原文。' : '尚未配置可用的大模型，语义问题无法自动改写。' });
        continue;
      }
      chapters[index] = {
        ...chapter,
        content: stripChapterBibliography(result.content),
        auto_corrected_at: now(),
      };
      fixes.push({ key: 'semantic_revision', chapterIndex: index, chapter: chapter.chapter, detail: `已修订“${chapter.chapter}”的引用或占位问题。` });
    } catch (error) {
      unresolved.push({ chapterIndex: index, chapter: chapter.chapter, detail: `自动修订失败：${error.message}` });
    }
  }

  chapters = removeLaterDuplicateParagraphs(chapters).map((chapter) => ({
    ...chapter,
    content: stripChapterBibliography(chapter.content),
  }));

  if (JSON.stringify(chapters) !== originalJson) {
    const update = db.prepare('UPDATE projects SET chapters_json = ?, final_check_json = NULL, updated_at = ? WHERE id = ? AND user_id = ? AND chapters_json = ?')
      .run(JSON.stringify(chapters), now(), projectId, userId, originalJson);
    if (update.changes !== 1) throw new Error('纠错期间正文已被其他操作修改，请刷新后重试');
  }

  const checkResult = await runFinalCheckWithAnalysis(projectId, userId, { runner });
  const manualFailures = (checkResult.checks || []).filter((item) => item.status === 'fail' && !item.autoFixable);
  unresolved.push(...manualFailures.map((item) => ({ key: item.key, detail: item.detail })));
  return {
    check: checkResult,
    workflow: getWorkflowState(projectId, userId),
    fixes,
    unresolved,
    nextAction: checkResult.passed ? 'final_document' : 'review_errors',
  };
}

// 生成最终文档（复用 chapters 合并 + docx 生成）
const exportsInFlight = new Map();
export async function generateFinalDocument(projectId, userId, options = {}) {
  const key = `${userId}:${projectId}:${options.template_id || ''}:${options.format || 'docx'}`;
  if (exportsInFlight.has(key)) return exportsInFlight.get(key);
  const pending = exportFinalDocument(projectId, userId, options);
  exportsInFlight.set(key, pending);
  try { return await pending; } finally { exportsInFlight.delete(key); }
}

async function exportFinalDocument(projectId, userId, { template_id, format } = {}) {
  const wf = getWorkflowState(projectId, userId);
  if (!wf || !['final_review', 'completed'].includes(wf.state)) throw new Error('当前尚未完成逐章确认，不能生成最终文档');
  const existingCheck = wf.finalCheck;
  if (!existingCheck || existingCheck.passed !== true) {
    throw new Error('请先运行全文一致性检查，并修复所有失败项后再输出最终文档');
  }
  const merged = mergeChapters(userId, projectId);
  if (existingCheck.contentVersion !== contentVersion(wf.project) || !inspectPaper(wf.project).passed || !(wf.project.sources?.references || []).every(hasReferenceProof)) {
    throw new Error('内容已更新或仍有未确认章节，请重新运行全文检查');
  }
  const cached = existingCheck.finalDocument;
  if ((!format || format === 'docx') && cached && cached.templateId === (template_id || null)) {
    const row = db.prepare('SELECT id, file_path FROM generated_docs WHERE id = ? AND user_id = ? AND project_id = ?').get(cached.id, userId, projectId);
    if (row && existsSync(join(fileURLToPath(new URL('../../uploads/docs/', import.meta.url)), row.file_path))) {
      return { doc: { id: row.id, downloadUrl: `/api/docs/download/${row.id}` }, content: merged.content, workflow: wf };
    }
  }
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
  const latest = getWorkflowState(projectId, userId);
  if (!latest || !['final_review', 'completed'].includes(latest.state) || contentVersion(latest.project) !== existingCheck.contentVersion) {
    throw new Error('导出期间内容已改变，请重新确认并检查后导出');
  }
  if (doc) db.prepare('UPDATE projects SET final_check_json = ? WHERE id = ? AND user_id = ?')
    .run(JSON.stringify({ ...existingCheck, finalDocument: { id: doc.id, templateId: template_id || null } }), projectId, userId);
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
    targetWords: p.delivery_target_words || (p.writing_requirements || '').match(/(\d{3,6})\s*(字|千字|万字)/)?.[0] || '',
    completion: `${done}/${chapters.length}`,
  };
}

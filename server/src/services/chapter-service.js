// 分章节生成服务（阶段三 3.2）
// - 进程内串行队列：同一项目同时只生成一章，避免并发写冲突与 API 限流
// - 章节草稿保存到 projects.chapters_json，前端轮询进度
// - 按已确认大纲逐章生成，后续章节可参考前序章节内容
import db from '../db.js';
import { runAI } from '../ai-service.js';
import { getProject } from './task-store.js';
import { now } from '../utils.js';
import { claimOrderExecution } from './order-claim.js';
import { transitionServiceToCompleted, transitionServiceToFailed } from './order-state.js';
import logger from '../logger.js';
import { replaceCitePlaceholders, filterVerifiedWritingReferences } from './paper-distillation.js';

// 蒸馏产物注入：分章节生成消费工作区 sources（smart-writing 持久化的框架/文献/数据/表格）
async function buildChapterAIParams(project, ch, context, userId, projectId) {
  const sources = project.sources || {};
  const params = {
    type: 'paragraph',
    topic: project.title,
    field: project.field,
  };

  // 1. 融合框架（研究方法/创新点/结论）注入上下文
  if (sources.framework && (sources.framework.methods?.length || sources.framework.innovations?.length)) {
    try {
      const { buildFrameworkContext } = await import('./paper-distillation.js');
      context += `\n\n${buildFrameworkContext(sources.framework, [])}`;
    } catch (err) {
      logger.warn('chapter', `框架上下文注入失败（忽略）: ${err.message}`);
    }
  }

  // 2. 真实文献 / benchmark 数据 / 套用表格注入（AI 只许引用，占位符由代码替换）
  if (Array.isArray(sources.references) && sources.references.length > 0) {
    params.references = sources.references;
  }
  if (Array.isArray(sources.benchmarks) && sources.benchmarks.length > 0) {
    params.benchmarks = sources.benchmarks;
  }
  if (Array.isArray(sources.tables) && sources.tables.length > 0) {
    params.dataTables = sources.tables;
  }

  // 3. 段落级证据检索注入（方案优先级 2 的核心缺口：生成段落必须绑定检索到的证据）
  //    按「章节标题 + 小节标题」作为查询，走 Qdrant+BGE-M3+reranker 混合检索（未配置则本地 BM25），
  //    把带 [EVIDENCE:id source=... page=... chunk=...] 标记的证据块注入上下文，
  //    供 AI 在陈述事实时引用，从而支撑「结论—证据—论文—页码」的溯源与评测断言。
  if (userId && projectId) {
    try {
      const { buildEvidenceContext } = await import('./evidence-engine.js');
      const evidenceQuery = [ch.chapter, ...(ch.sections || []).map((s) => s.title || s)].filter(Boolean).join(' ');
      const ev = await buildEvidenceContext(userId, projectId, evidenceQuery, { maxChars: 5000, limit: 8 });
      if (ev.count > 0) {
        context += `\n\n${ev.context}`;
        // 证据编号白名单交给 AI：只允许引用这些编号，评测断言据此校验可溯源性
        params.evidenceIds = ev.ids;
      }
    } catch (err) {
      // 证据检索失败不阻断生成，仅降级为无证据段落（评测会据此提示证据覆盖不足）
      logger.warn('chapter', `段落级证据检索失败（降级为无证据生成）: ${err.message}`);
    }
  }

  params.context = `当前要撰写章节：${ch.chapter}\n\n${context}`;
  return params;
}
// 进程内队列：正在生成中的 projectId 集合
const running = new Set();

// 章节数硬上限：超长大纲（恶意构造或模型失控输出）会令分章节生成成本失控
const MAX_CHAPTERS = 15;

export function isGenerating(projectId) {
  return running.has(projectId);
}

function getChapters(projectId) {
  const row = db.prepare('SELECT chapters_json FROM projects WHERE id = ?').get(projectId);
  try { return JSON.parse(row?.chapters_json || '[]'); } catch { return []; }
}

// 保存章节草稿；orderId 非空时顺带续租订单（刷新 orders.updated_at）：
// 长任务逐章保存期间不断续期，防止超过 30 分钟 claim 超时被其他实例判定卡死抢占（多实例双跑烧钱）
function saveChapters(projectId, chapters, orderId = null) {
  if (orderId) {
    db.prepare("UPDATE orders SET updated_at = ? WHERE id = ? AND service_status = 'processing'")
      .run(now(), orderId);
  }
  db.prepare('UPDATE projects SET chapters_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(chapters), now(), projectId);
}

// 订单执行超时（秒）：进入 processing 超过该时长视为「卡死」（进程崩溃/重启遗留），允许抢占重试
// 超时抢占逻辑统一在 order-claim.js 中实现

// 校验章节生成所需订单：需已支付的 writing_fulltext 订单
// 注意：仅接受"全文生成"订单——写作段落（writing_paragraph）是独立功能，不能驱动整篇论文生成
// allowCompleted：章节重写（regenerateChapter）允许在订单已完成（completed）后进行，属同一订单服务的一部分
function validateOrder(userId, orderNo, projectId, { allowCompleted = false } = {}) {
  if (!orderNo) return { ok: false, error: '请先下单支付后再生成正文', needOrder: true, itemType: 'writing_fulltext' };
  const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo);
  if (!order) return { ok: false, error: '订单不存在', needOrder: true, itemType: 'writing_fulltext' };
  if (order.user_id !== userId) return { ok: false, error: '无权使用该订单' };
  if (order.type !== 'feature') return { ok: false, error: '订单类型不正确' };
  if (order.item_type !== 'writing_fulltext') return { ok: false, error: '订单与功能不匹配（分章节生成需全文生成订单）' };
  if (order.status !== 'paid') return { ok: false, error: '订单未支付' };
  // failed 允许重试：AI 瞬时失败不应锁死已付费订单
  const allowed = ['pending', 'processing', 'failed'];
  if (allowCompleted) allowed.push('completed');
  if (!allowed.includes(order.service_status)) return { ok: false, error: '订单服务已结束' };
  // 一单多用防护：订单已绑定到其他论文工作区时拒绝（同一订单只能服务一个项目，
  // 防 A 项目生成期间同订单对 B 项目白嫖生成/重写）
  if (order.project_id != null && order.project_id !== projectId) {
    return { ok: false, error: '该订单已绑定其他论文工作区，请重新下单' };
  }
  return { ok: true, order };
}

// 从已确认大纲初始化章节草稿
function buildChapters(outline) {
  if (!Array.isArray(outline) || outline.length === 0) return [];
  // 章节数硬上限：超长大纲直接报错，避免生成成本失控
  if (outline.length > MAX_CHAPTERS) {
    throw new Error(`章节数超过上限（最多 ${MAX_CHAPTERS} 章，当前 ${outline.length} 章）`);
  }
  return outline.map((ch, i) => ({
    id: `ch_${i + 1}`,
    chapter: ch.chapter || ch.title || `第${i + 1}章`,
    sections: ch.sections || [],
    content: '',
    status: 'pending', // pending / processing / done / failed
  }));
}

// 生成单章内容
async function generateChapter(project, chapters, idx) {
  const userId = project.user_id;
  const ch = chapters[idx];
  const outlineText = (project.outline || []).map((c) => {
    const secs = (c.sections || []).map((s) => `  - ${s.title || ''}`).join('\n');
    return `${c.chapter || c.title || ''}\n${secs}`;
  }).join('\n');
  const prevContent = chapters.slice(0, idx).map((c) => c.content).filter(Boolean).join('\n\n').slice(-6000);
  const context = [
    `论文标题：${project.title}`,
    project.field ? `学科领域：${project.field}` : '',
    project.writing_requirements ? `写作要求：${project.writing_requirements}` : '',
    '',
    '【已确认大纲】',
    outlineText,
    prevContent ? `\n【前序章节（供衔接参考）】\n${prevContent}` : '',
  ].filter(Boolean).join('\n');

  const params = await buildChapterAIParams(project, ch, context, userId, project.id);
  let result;
  if (project.workflow_mode === 'full') {
    const { orchestrateChapter } = await import('./orchestrator.js');
    result = await orchestrateChapter({ project, chapter: ch, context: params.context, references: params.references || [], benchmarks: params.benchmarks || [], dataTables: params.dataTables || [], evidenceIds: params.evidenceIds || [] });
  } else {
    result = await runAI('writing', params);
  }
  let content = result.content || '';

  // 占位符替换：引用编号 + 数据图表由代码生成（与全文生成路径保持一致）
  // 注意：章节内只替换编号，不追加参考文献列表（参考文献在全文合并/导出时统一生成一次）
  try {
    const { replaceCitePlaceholders, replaceChartPlaceholders, ensureGroundedVisuals } = await import('./paper-distillation.js');
    const sources = project.sources || {};
    content = ensureGroundedVisuals(content, {
      benchmarks: sources.benchmarks || [], tables: sources.tables || [], references: sources.references || [],
    }, ch.chapter);
    content = replaceChartPlaceholders(
      replaceCitePlaceholders(content, sources.references || null, { appendReferences: false }),
      sources.benchmarks || []
    );
  } catch (err) {
    logger.warn('chapter', `章节占位符替换失败（忽略）: ${err.message}`);
  }
  return { content, orchestration: result.plan ? { plan: result.plan, agents: result.agents } : null };
}

// 启动分章节生成（异步执行，立即返回）
export async function startChapterGeneration(userId, projectId, orderNo) {
  const project = getProject(projectId, userId);
  if (!project) throw new Error('工作区不存在');
  if (!project.outline_confirmed_at) throw new Error('请先确认大纲再生成正文');
  if ((project.outline || []).length === 0) throw new Error('大纲为空，请先生成并确认大纲');
  const verifiedReferences = filterVerifiedWritingReferences(project.sources?.references || []);
  if (verifiedReferences.length < 3) {
    throw new Error('真实文献不足：请先完成深度文献调研，至少取得 3 篇可回查论文后再生成正文');
  }
  // 章节数硬上限：与 buildChapters 一致，超限直接报错（防超长大纲生成成本失控）
  if ((project.outline || []).length > MAX_CHAPTERS) {
    throw new Error(`章节数超过上限（最多 ${MAX_CHAPTERS} 章，当前 ${project.outline.length} 章）`);
  }

  const bill = validateOrder(userId, orderNo, projectId);
  if (!bill.ok) {
    const err = new Error(bill.error);
    err.needOrder = bill.needOrder;
    err.itemType = bill.itemType;
    throw err;
  }

  let chapters = getChapters(projectId);
  if (chapters.length === 0) {
    chapters = buildChapters(project.outline);
    saveChapters(projectId, chapters);
  }

  // 全部已完成则直接返回，不重复入队
  const hasPending = chapters.some((c) => c.status !== 'done');
  if (!hasPending) {
    // 若订单正处于本次生成会话中（processing），补齐完成状态，防止残留 processing 被复用于其他项目
    transitionServiceToCompleted(bill.order.id);
    return { queued: false, chapters };
  }

  if (running.has(projectId)) {
    return { queued: true, alreadyRunning: true, chapters: getChapters(projectId) };
  }

  // 原子抢占订单执行权：pending/failed → processing。
  // processing（正在生成/已绑定其他项目）→ 拒绝，防一单多论文
  if (!claimOrderExecution(bill.order, { projectId })) {
    throw new Error('该订单正在生成中或服务已结束，请勿重复提交');
  }
  running.add(projectId);

  (async () => {
    try {
      let cur = getChapters(projectId);
      for (let i = 0; i < cur.length; i++) {
        cur = getChapters(projectId);
        if (cur[i]?.status === 'done') continue;
        cur[i] = { ...cur[i], status: 'processing' };
        // 每章保存时续租订单（更新 orders.updated_at），防长任务被 claim 超时抢占
        saveChapters(projectId, cur, bill.order.id);

        const generated = await generateChapter(project, cur, i);

        cur = getChapters(projectId);
        cur[i] = { ...cur[i], content: generated.content, orchestration: generated.orchestration, status: 'done' };
        saveChapters(projectId, cur, bill.order.id);
      }
      // 全部完成：标记订单服务完成（仅当仍处于 processing，防并发覆盖）
      transitionServiceToCompleted(bill.order.id);
    } catch (err) {
      logger.error('chapter', `章节生成失败 project=${projectId}: ${err.message}`);
      const cur = getChapters(projectId).map((c) => (c.status === 'processing' ? { ...c, status: 'failed' } : c));
      saveChapters(projectId, cur);
      // failed 状态允许用户重新发起生成（重试），不再永久锁死订单
      transitionServiceToFailed(bill.order.id);
    } finally {
      running.delete(projectId);
    }
  })();

  return { queued: true, chapters: getChapters(projectId) };
}

// 单章重写次数上限：一次全文订单 = 全论文生成 + 每章最多 3 次重写（防一单无限白嫖 AI）
const MAX_REGEN_PER_CHAPTER = 3;

// 重新生成某一章
export async function regenerateChapter(userId, projectId, chapterId, orderNo) {
  const project = getProject(projectId, userId);
  if (!project) throw new Error('工作区不存在');
  // 章节重写是同一订单服务的一部分：允许订单已完成（completed）后继续重写（受重写次数上限约束）
  const bill = validateOrder(userId, orderNo, projectId, { allowCompleted: true });
  if (!bill.ok) {
    const err = new Error(bill.error);
    err.needOrder = bill.needOrder;
    err.itemType = bill.itemType;
    throw err;
  }

  const chapters = getChapters(projectId);
  const idx = chapters.findIndex((c) => c.id === chapterId);
  if (idx === -1) throw new Error('章节不存在');
  if (running.has(projectId)) throw new Error('该论文正在生成中，请稍后再试');

  // 重写次数限制：每章最多重写 3 次（含生成完成后），防一单无限白嫖 AI
  const regenCount = Number(chapters[idx].regenerate_count || 0);
  if (regenCount >= MAX_REGEN_PER_CHAPTER) {
    throw new Error(`该章节重写次数已达上限（每章最多 ${MAX_REGEN_PER_CHAPTER} 次）`);
  }

  running.add(projectId);
  try {
    chapters[idx] = { ...chapters[idx], status: 'processing', content: '', regenerate_count: regenCount + 1 };
    saveChapters(projectId, chapters);
    const generated = await generateChapter(project, chapters, idx);
    const cur = getChapters(projectId);
    cur[idx] = { ...cur[idx], content: generated.content, orchestration: generated.orchestration, status: 'done' };
    saveChapters(projectId, cur);
    return { chapter: cur[idx], chapters: cur };
  } catch (err) {
    const cur = getChapters(projectId);
    cur[idx] = { ...cur[idx], status: 'failed' };
    saveChapters(projectId, cur);
    throw err;
  } finally {
    running.delete(projectId);
  }
}

// 编辑某章内容
export function editChapter(userId, projectId, chapterId, content) {
  const project = getProject(projectId, userId);
  if (!project) throw new Error('工作区不存在');
  const chapters = getChapters(projectId);
  const idx = chapters.findIndex((c) => c.id === chapterId);
  if (idx === -1) throw new Error('章节不存在');
  chapters[idx] = { ...chapters[idx], content: String(content || '') };
  saveChapters(projectId, chapters);
  return { chapter: chapters[idx], chapters };
}

// 生成单个指定章节（工作流「一次只生成一章」：当前章确认后才允许下一章）
// 复用 buildChapterAIParams / generateChapter 与订单校验、文献≥3 校验、并发锁
export async function generateSingleChapter(userId, projectId, chapterIndex, orderNo) {
  const project = getProject(projectId, userId);
  if (!project) throw new Error('工作区不存在');
  if (!project.outline_confirmed_at) throw new Error('请先确认大纲再生成正文');
  const verifiedReferences = filterVerifiedWritingReferences(project.sources?.references || []);
  if (verifiedReferences.length < 3) {
    throw new Error('真实文献不足：请先完成深度文献调研，至少取得 3 篇可回查论文后再生成正文');
  }
  // 订单号由工作流层从项目持久化权益中补齐；这里仍保留严格的订单/项目归属校验。
  const bill = validateOrder(userId, orderNo, projectId);
  if (!bill.ok) {
    const err = new Error(bill.error);
    err.needOrder = bill.needOrder;
    err.itemType = bill.itemType;
    throw err;
  }
  let chapters = getChapters(projectId);
  if (chapters.length === 0) {
    chapters = buildChapters(project.outline);
    saveChapters(projectId, chapters);
  }
  if (!chapters[chapterIndex]) throw new Error('章节不存在');
  if (chapters[chapterIndex].status === 'done') {
    return { queued: false, alreadyDone: true, chapter: chapters[chapterIndex], chapters };
  }
  if (running.has(projectId)) {
    return { queued: false, alreadyRunning: true, chapters: getChapters(projectId) };
  }
  // 首章抢占订单执行权；同一项目后续章节复用已绑定且仍 processing 的套餐订单。
  // 不能对每章再次 claim，否则订单状态机会把第二章错误判为重复执行。
  const alreadyBoundToProject = bill.order.project_id === projectId && bill.order.service_status === 'processing';
  if (!alreadyBoundToProject && !claimOrderExecution(bill.order, { projectId })) {
    throw new Error('该订单正在生成中或服务已结束，请勿重复提交');
  }
  running.add(projectId);
  try {
    chapters[chapterIndex] = { ...chapters[chapterIndex], status: 'processing' };
    saveChapters(projectId, chapters, bill.order.id);
    const generated = await generateChapter(project, chapters, chapterIndex);
    const cur = getChapters(projectId);
    cur[chapterIndex] = { ...cur[chapterIndex], content: generated.content, orchestration: generated.orchestration, status: 'done' };
    saveChapters(projectId, cur, bill.order.id);
    return { queued: true, chapter: cur[chapterIndex], chapters: cur };
  } catch (err) {
    const cur = getChapters(projectId);
    cur[chapterIndex] = { ...cur[chapterIndex], status: 'failed' };
    saveChapters(projectId, cur);
    transitionServiceToFailed(bill.order.id, { reason: '多模型章节生成失败' });
    throw err;
  } finally {
    running.delete(projectId);
  }
}

// 合并全部章节为全文（含标题 + 章节标题），供导出 Word
export function mergeChapters(userId, projectId) {
  const project = getProject(projectId, userId);
  if (!project) throw new Error('工作区不存在');
  const chapters = getChapters(projectId);
  const body = chapters.map((c) => {
    const content = String(c.content || '').trim();
    if (content) {
      // 生成链产出的正文自带「## 章标题 / ### 小节标题」结构，直接采用；
      // 不得再额外拼接大纲小节标题——否则所有小标题堆砌在正文之前，且与正文内容重复错位
      return /^#{1,3}\s+\S/.test(content) ? content : `## ${c.chapter}\n\n${content}`;
    }
    // 未生成的章节保留大纲结构占位
    const secText = (c.sections || []).map((s) => (s.title ? `### ${s.title}` : '')).filter(Boolean).join('\n');
    return `## ${c.chapter}\n${secText}\n\n（本章内容待生成）`;
  }).join('\n\n');
  const references = project.sources?.references || [];
  return { title: project.title, content: replaceCitePlaceholders(body, references), chapters };
}

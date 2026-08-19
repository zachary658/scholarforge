// 分章节生成服务（阶段三 3.2）
// - 进程内串行队列：同一项目同时只生成一章，避免并发写冲突与 API 限流
// - 章节草稿保存到 projects.chapters_json，前端轮询进度
// - 按已确认大纲逐章生成，后续章节可参考前序章节内容
import db from '../db.js';
import { runAI } from '../ai-service.js';
import { getProject } from './task-store.js';
import { now } from '../utils.js';
import logger from '../logger.js';

// 进程内队列：正在生成中的 projectId 集合
const running = new Set();

export function isGenerating(projectId) {
  return running.has(projectId);
}

function getChapters(projectId) {
  const row = db.prepare('SELECT chapters_json FROM projects WHERE id = ?').get(projectId);
  try { return JSON.parse(row?.chapters_json || '[]'); } catch { return []; }
}

function saveChapters(projectId, chapters) {
  db.prepare('UPDATE projects SET chapters_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(chapters), now(), projectId);
}

// 校验章节生成所需订单：需已支付的 writing_fulltext / writing_paragraph 订单
function validateOrder(userId, orderNo) {
  if (!orderNo) return { ok: false, error: '请先下单支付后再生成正文', needOrder: true, itemType: 'writing_fulltext' };
  const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo);
  if (!order) return { ok: false, error: '订单不存在', needOrder: true, itemType: 'writing_fulltext' };
  if (order.user_id !== userId) return { ok: false, error: '无权使用该订单' };
  if (order.type !== 'feature') return { ok: false, error: '订单类型不正确' };
  if (!['writing_fulltext', 'writing_paragraph'].includes(order.item_type)) return { ok: false, error: '订单与功能不匹配' };
  if (order.status !== 'paid') return { ok: false, error: '订单未支付' };
  if (!['pending', 'processing'].includes(order.service_status)) return { ok: false, error: '订单服务已结束' };
  return { ok: true, order };
}

// 从已确认大纲初始化章节草稿
function buildChapters(outline) {
  if (!Array.isArray(outline) || outline.length === 0) return [];
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

  const result = await runAI('writing', {
    type: 'paragraph',
    topic: project.title,
    field: project.field,
    context: `当前要撰写章节：${ch.chapter}\n\n${context}`,
  });
  return result.content || '';
}

// 启动分章节生成（异步执行，立即返回）
export async function startChapterGeneration(userId, projectId, orderNo) {
  const project = getProject(projectId, userId);
  if (!project) throw new Error('工作区不存在');
  if (!project.outline_confirmed_at) throw new Error('请先确认大纲再生成正文');
  if ((project.outline || []).length === 0) throw new Error('大纲为空，请先生成并确认大纲');

  const bill = validateOrder(userId, orderNo);
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
  if (!hasPending) return { queued: false, chapters };

  if (running.has(projectId)) {
    return { queued: true, alreadyRunning: true, chapters: getChapters(projectId) };
  }
  running.add(projectId);

  // 标记订单服务进行中
  db.prepare("UPDATE orders SET service_status = 'processing' WHERE id = ?").run(bill.order.id);

  (async () => {
    try {
      let cur = getChapters(projectId);
      for (let i = 0; i < cur.length; i++) {
        cur = getChapters(projectId);
        if (cur[i]?.status === 'done') continue;
        cur[i] = { ...cur[i], status: 'processing' };
        saveChapters(projectId, cur);

        const content = await generateChapter(project, cur, i);

        cur = getChapters(projectId);
        cur[i] = { ...cur[i], content, status: 'done' };
        saveChapters(projectId, cur);
      }
      // 全部完成：标记订单服务完成
      db.prepare("UPDATE orders SET service_status = 'completed' WHERE id = ?").run(bill.order.id);
    } catch (err) {
      logger.error('chapter', `章节生成失败 project=${projectId}: ${err.message}`);
      const cur = getChapters(projectId).map((c) => (c.status === 'processing' ? { ...c, status: 'failed' } : c));
      saveChapters(projectId, cur);
      db.prepare("UPDATE orders SET service_status = 'failed' WHERE id = ?").run(bill.order.id);
    } finally {
      running.delete(projectId);
    }
  })();

  return { queued: true, chapters: getChapters(projectId) };
}

// 重新生成某一章
export async function regenerateChapter(userId, projectId, chapterId, orderNo) {
  const project = getProject(projectId, userId);
  if (!project) throw new Error('工作区不存在');
  const bill = validateOrder(userId, orderNo);
  if (!bill.ok) throw new Error(bill.error);

  const chapters = getChapters(projectId);
  const idx = chapters.findIndex((c) => c.id === chapterId);
  if (idx === -1) throw new Error('章节不存在');
  if (running.has(projectId)) throw new Error('该论文正在生成中，请稍后再试');

  running.add(projectId);
  try {
    chapters[idx] = { ...chapters[idx], status: 'processing', content: '' };
    saveChapters(projectId, chapters);
    const content = await generateChapter(project, chapters, idx);
    const cur = getChapters(projectId);
    cur[idx] = { ...cur[idx], content, status: 'done' };
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

// 合并全部章节为全文（含标题 + 章节标题），供导出 Word
export function mergeChapters(userId, projectId) {
  const project = getProject(projectId, userId);
  if (!project) throw new Error('工作区不存在');
  const chapters = getChapters(projectId);
  const body = chapters.map((c) => {
    const secText = (c.sections || []).map((s) => (s.title ? `### ${s.title}` : '')).filter(Boolean).join('\n');
    return `## ${c.chapter}\n${secText}\n\n${c.content || '（本章内容待生成）'}`;
  }).join('\n\n');
  return { title: project.title, content: body, chapters };
}

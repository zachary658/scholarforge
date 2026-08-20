// AI 任务历史 + 论文工作区服务
// - 保存每次 AI 调用的完整输入输出
// - 论文工作区 CRUD + 大纲管理
// - 上下文组装：从工作区大纲和历史任务中提取相关上下文
import db from '../db.js';
import logger from '../logger.js';
import { now } from '../utils.js';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getSetting } from '../config-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsDir = join(__dirname, '..', 'uploads', 'docs');

// 上下文最大字符数（防止 token 暴涨）
const MAX_CONTEXT_CHARS = 4000;
// 任务输入/输出文本最大存储字符数（防超大文本写爆 DB 行）
const MAX_TASK_TEXT = 100000;
// 任务 params JSON 最大字符数
const MAX_TASK_PARAMS = 20000;

// ========== AI 任务历史 ==========

// 校验工作区归属：projectId 为空视为通过；非本人所有返回 false
// 安全：防止跨用户把任务写入他人工作区（存储型 prompt 注入 / 上下文污染）
export function isProjectOwned(userId, projectId) {
  if (!projectId) return true;
  const row = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId);
  return !!row;
}

// 保存一次 AI 调用的完整记录
export function saveTask({
  userId,
  projectId = null,
  toolType,
  action,
  title = null,
  inputText = '',
  outputText = '',
  params = {},
  contextSummary = '',
  modelName = '',
  tokens = 0,
  chargeType = 'none',
  amount = 0,
  orderId = null,
  usageLogId = null,
  status = 'success',
}) {
  // 安全（纵深防御）：任务只能写入本人工作区；跨用户 projectId 直接丢弃关联，
  // 防止任何调用路径（含未来新增）把内容注入他人项目上下文
  if (projectId && !isProjectOwned(userId, projectId)) {
    logger.warn('task-store', `rejected cross-user project_id=${projectId} for user=${userId}, task=${toolType}/${action}`);
    projectId = null;
  }
  // 自动生成标题：取输入前 30 字
  const autoTitle = title || (inputText ? inputText.slice(0, 30).replace(/\n/g, ' ') : `${toolType}-${action}`);
  // 截断超长文本，防 DB 行过大（输入/输出各上限 MAX_TASK_CHARS，params 上限 MAX_TASK_PARAMS）
  const safeInput = typeof inputText === 'string' ? inputText.slice(0, MAX_TASK_TEXT) : String(inputText || '');
  const safeOutput = typeof outputText === 'string' ? outputText.slice(0, MAX_TASK_TEXT) : String(outputText || '');
  const safeParams = JSON.stringify(params || {}).slice(0, MAX_TASK_PARAMS);
  const safeCtx = typeof contextSummary === 'string' ? contextSummary.slice(0, MAX_TASK_TEXT) : '';
  const info = db.prepare(
    `INSERT INTO ai_tasks
      (user_id, project_id, tool_type, action, title, input_text, output_text, params_json, context_summary,
       model_name, tokens, charge_type, amount, order_id, usage_log_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId, projectId, toolType, action, autoTitle,
    safeInput, safeOutput, safeParams, safeCtx,
    modelName, tokens, chargeType, amount, orderId, usageLogId, status
  );
  // 更新工作区的 updated_at
  if (projectId) {
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), projectId);
  }
  return info.lastInsertRowid;
}

// 查询任务历史（分页+筛选）
export function listTasks({ userId, projectId = null, toolType = null, keyword = null, page = 1, size = 20 }) {
  const offset = (page - 1) * size;
  let where = 'WHERE t.user_id = ?';
  const params = [userId];
  if (projectId) { where += ' AND t.project_id = ?'; params.push(projectId); }
  if (toolType) { where += ' AND t.tool_type = ?'; params.push(toolType); }
  if (keyword) {
    where += ' AND (t.title LIKE ? OR t.input_text LIKE ? OR t.output_text LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  const total = db.prepare(`SELECT COUNT(*) as c FROM ai_tasks t ${where}`).get(...params).c;
  const tasks = db.prepare(
    `SELECT t.id, t.project_id, t.tool_type, t.action, t.title, t.model_name, t.tokens,
            t.charge_type, t.amount, t.status, t.created_at,
            LENGTH(t.input_text) as input_len, LENGTH(t.output_text) as output_len,
            SUBSTR(t.output_text, 1, 200) as output_preview,
            p.title as project_title
     FROM ai_tasks t
     LEFT JOIN projects p ON p.id = t.project_id
     ${where}
     ORDER BY t.created_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, size, offset);

  return { tasks, total, page, size, pages: Math.ceil(total / size) };
}

// 获取任务详情（含完整输入输出）
export function getTaskDetail(taskId, userId) {
  const task = db.prepare(
    `SELECT t.*, p.title as project_title
     FROM ai_tasks t
     LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.id = ? AND t.user_id = ?`
  ).get(taskId, userId);
  if (!task) return null;
  try { task.params = JSON.parse(task.params_json || '{}'); } catch { task.params = {}; }
  delete task.params_json;
  return task;
}

// 删除任务
export function deleteTask(taskId, userId) {
  const r = db.prepare('DELETE FROM ai_tasks WHERE id = ? AND user_id = ?').run(taskId, userId);
  return r.changes > 0;
}

// 清理过期任务（90 天前）
export function cleanupOldTasks() {
  const expireAt = now() - 90 * 86400;
  const r = db.prepare('DELETE FROM ai_tasks WHERE created_at < ?').run(expireAt);
  return r.changes;
}

// 清理过期的生成文档（按 doc_retention_days 配置，默认 30 天）
// 同时删除磁盘文件和数据库记录，防止磁盘耗尽
export function cleanupOldDocs() {
  const days = parseInt(getSetting('doc_retention_days', '30'), 10) || 30;
  const cutoff = now() - days * 86400;
  const old = db.prepare('SELECT id, file_path, feature FROM generated_docs WHERE created_at < ?').all(cutoff);
  let deleted = 0;
  for (const d of old) {
    // 删除磁盘文件（preset:// 开头的是虚拟路径，无实际文件）
    if (d.file_path && !d.file_path.startsWith('preset://')) {
      try {
        const filePath = join(docsDir, d.file_path);
        // 校验路径不包含 .. 防遍历
        if (!d.file_path.includes('..')) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        // 文件可能已不存在，忽略错误继续删 DB 记录
        if (err.code !== 'ENOENT') logger.error('cleanup-docs', `unlink failed: ${d.file_path} ${err.message}`);
      }
    }
    db.prepare('DELETE FROM generated_docs WHERE id = ?').run(d.id);
    deleted++;
  }
  return deleted;
}

// ========== 论文工作区 ==========

export function createProject({ userId, title, field = '', description = '', writingRequirements = '', outline = [] }) {
  const info = db.prepare(
    `INSERT INTO projects (user_id, title, field, description, writing_requirements, outline_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, title, field, description, writingRequirements, JSON.stringify(outline));
  return getProject(info.lastInsertRowid, userId);
}

export function getProject(projectId, userId) {
  const p = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId);
  if (!p) return null;
  try { p.outline = JSON.parse(p.outline_json || '[]'); } catch { p.outline = []; }
  delete p.outline_json;
  try { p.chapters = JSON.parse(p.chapters_json || '[]'); } catch { p.chapters = []; }
  delete p.chapters_json;
  try { p.sources = JSON.parse(p.sources_json || '{}'); } catch { p.sources = {}; }
  delete p.sources_json;
  return p;
}

export function listProjects(userId) {
  const projects = db.prepare(
    `SELECT p.*,
            (SELECT COUNT(*) FROM ai_tasks WHERE project_id = p.id) as task_count
     FROM projects p
     WHERE p.user_id = ? AND p.status = 'active'
     ORDER BY p.updated_at DESC`
  ).all(userId);
  for (const p of projects) {
    try { p.outline = JSON.parse(p.outline_json || '[]'); } catch { p.outline = []; }
    delete p.outline_json;
    try { p.chapters = JSON.parse(p.chapters_json || '[]'); } catch { p.chapters = []; }
    delete p.chapters_json;
    try { p.sources = JSON.parse(p.sources_json || '{}'); } catch { p.sources = {}; }
    delete p.sources_json;
  }
  return projects;
}

export function updateProject(projectId, userId, updates) {
  const allowed = ['title', 'field', 'description', 'writing_requirements', 'outline_json', 'status'];
  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(updates)) {
    const col = k === 'writingRequirements' ? 'writing_requirements' : k === 'outline' ? 'outline_json' : k;
    if (!allowed.includes(col)) continue;
    sets.push(`${col} = ?`);
    params.push(col === 'outline_json' ? JSON.stringify(v) : v);
  }
  if (sets.length === 0) return getProject(projectId, userId);
  sets.push(`updated_at = ${now()}`);
  params.push(projectId, userId);
  db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  return getProject(projectId, userId);
}

export function deleteProject(projectId, userId) {
  // 软删除：归档而非物理删除，保留关联任务
  const r = db.prepare("UPDATE projects SET status = 'archived', updated_at = ? WHERE id = ? AND user_id = ?").run(now(), projectId, userId);
  return r.changes > 0;
}

// 确认（或重新确认）大纲：记录确认时间，全文生成前强制校验
export function confirmOutline(projectId, userId) {
  const p = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId);
  if (!p) return null;
  db.prepare('UPDATE projects SET outline_confirmed_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), projectId);
  return getProject(projectId, userId);
}

// 持久化蒸馏产物（检索→蒸馏：框架/文献/benchmark/表格数据）到工作区
// 分章节生成与全文生成统一从 sources_json 消费，保证蒸馏结果贯通到正文
export function saveProjectSources(projectId, userId, sources) {
  if (!projectId || !userId) return false;
  const r = db.prepare(
    'UPDATE projects SET sources_json = ?, updated_at = ? WHERE id = ? AND user_id = ?'
  ).run(JSON.stringify(sources || {}), now(), projectId, userId);
  return r.changes > 0;
}

// ========== 上下文组装 ==========

// 从论文工作区提取上下文，注入到 AI 调用的 prompt 中
// 策略：
//   1. 论文标题 + 学科 + 写作要求（基础信息，必带）
//   2. 大纲（如果存在，带结构）
//   3. 同工作区最近的相关任务输出（智能截断，不超过 MAX_CONTEXT_CHARS）
// 安全：必须校验 userId 归属，防止跨用户读取他人工作区数据（IDOR）
export function buildProjectContext(projectId, userId, { currentToolType = '', currentAction = '', maxChars = MAX_CONTEXT_CHARS } = {}) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId);
  if (!project) return { context: '', summary: '' };

  let outline = [];
  try { outline = JSON.parse(project.outline_json || '[]'); } catch {}

  const parts = [];
  const summaryParts = [];

  // 1. 基础信息
  parts.push(`【论文信息】`);
  parts.push(`标题：${project.title}`);
  if (project.field) parts.push(`学科领域：${project.field}`);
  if (project.writing_requirements) parts.push(`写作要求：${project.writing_requirements}`);
  if (project.description) parts.push(`论文描述：${project.description}`);
  summaryParts.push(`论文《${project.title}》`);

  // 2. 大纲
  if (outline.length > 0) {
    parts.push('');
    parts.push(`【论文大纲】`);
    let usedChars = parts.join('\n').length;
    for (const ch of outline) {
      const chLine = `${ch.chapter || ch.title || ''}`;
      parts.push(chLine);
      usedChars += chLine.length;
      if (ch.sections && ch.sections.length > 0) {
        for (const sec of ch.sections) {
          const secLine = `  - ${sec.title || ''}${sec.content ? ': ' + sec.content.slice(0, 100) : ''}`;
          if (usedChars + secLine.length > maxChars * 0.6) break; // 大纲最多占 60%
          parts.push(secLine);
          usedChars += secLine.length;
        }
      }
    }
    summaryParts.push(`大纲(${outline.length}章)`);
  }

  // 3. 同工作区最近的相关任务输出
  // 智能选取：优先选同工具类型的，其次选最近的
  // 安全：必须按 user_id 过滤，防止他人注入到本工作区的任务污染上下文
  const recentTasks = db.prepare(
    `SELECT tool_type, action, title, output_text, created_at
     FROM ai_tasks
     WHERE project_id = ? AND user_id = ? AND status = 'success' AND output_text != ''
     ORDER BY
       CASE WHEN tool_type = ? THEN 0 ELSE 1 END,
       created_at DESC
     LIMIT 5`
  ).all(projectId, userId, currentToolType);

  if (recentTasks.length > 0) {
    parts.push('');
    parts.push(`【历史相关内容】`);
    let contextChars = parts.join('\n').length;
    let usedCount = 0;
    for (const t of recentTasks) {
      if (contextChars >= maxChars) break;
      const remaining = maxChars - contextChars;
      const output = t.output_text.slice(0, Math.min(remaining - 100, 800)); // 每条最多 800 字
      if (output.length < 50) continue; // 太短的不带
      const label = `[${t.action} ${new Date(t.created_at * 1000).toLocaleDateString('zh-CN')}] ${t.title}`;
      parts.push(label);
      parts.push(output);
      parts.push('');
      contextChars += label.length + output.length + 2;
      usedCount++;
    }
    if (usedCount > 0) summaryParts.push(`历史${usedCount}条`);
  }

  return {
    context: parts.join('\n'),
    summary: summaryParts.join(' · '),
  };
}

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
import { replaceDistilledEvidence } from './evidence-engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsDir = join(__dirname, '..', '..', 'uploads', 'docs');

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
  progress = null,
  stage = null,
  errorCode = null,
  retryCount = 0,
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
       model_name, tokens, charge_type, amount, order_id, usage_log_id, status, progress, stage, error_code, retry_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId, projectId, toolType, action, autoTitle,
    safeInput, safeOutput, safeParams, safeCtx,
    modelName, tokens, chargeType, amount, orderId, usageLogId, status,
    progress == null ? (status === 'success' ? 100 : 0) : progress,
    stage == null ? null : String(stage),
    errorCode == null ? null : String(errorCode),
    retryCount
  );
  // 更新工作区的 updated_at
  if (projectId) {
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), projectId);
    // 任务成功后，若系统推导进度已跨过当前阶段，自动前推 current_stage（只进不退）
    if (status === 'success') syncProjectStage(userId, projectId);
  }
  return info.lastInsertRowid;
}

// 更新既有任务的执行结果（后台任务/重试用：不再新建记录，原地改写状态与产物）
// fields 可含：status / outputText / modelName / tokens / progress / stage / errorCode
export function updateTaskResult(taskId, userId, fields = {}) {
  const map = {
    status: 'status',
    outputText: 'output_text',
    modelName: 'model_name',
    tokens: 'tokens',
    progress: 'progress',
    stage: 'stage',
    errorCode: 'error_code',
  };
  const sets = [];
  const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (!(k in fields)) continue;
    let v = fields[k];
    if (col === 'output_text' && typeof v === 'string') v = v.slice(0, MAX_TASK_TEXT);
    sets.push(`${col} = ?`);
    params.push(v);
  }
  if (sets.length === 0) return false;
  params.push(taskId, userId);
  const r = db.prepare(`UPDATE ai_tasks SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  // 后台重试成功后同步推进阶段（与 saveTask 成功路径一致）
  if (fields.status === 'success') {
    const projId = db.prepare('SELECT project_id FROM ai_tasks WHERE id = ? AND user_id = ?').get(taskId, userId)?.project_id;
    if (projId) syncProjectStage(userId, projId);
  }
  return r.changes > 0;
}

// ===== 失败任务错误分类（面向客户的错误码） =====
// 把内部异常归类为可理解的 error_code 与可重试标记，供前端展示「重新执行」或「联系客服」。
export function classifyTaskError(err) {
  const msg = String((err && err.message) || (err && err.code) || '');
  if (/timeout|超时|etimedout|econnreset|abort|网络/i.test(msg)) {
    return { code: 'network_timeout', retryable: true, label: '网络超时，请重试' };
  }
  if (/过长|超限|too\s*long|exceed|超过|字符数|字数/i.test(msg)) {
    return { code: 'input_too_long', retryable: false, label: '输入内容过长' };
  }
  if (/资料|解析|parse|material|文件|读取/i.test(msg)) {
    return { code: 'material_parse_failed', retryable: false, label: '资料解析失败' };
  }
  if (/余额|订单|无权|配额|quota|insufficient|payment|付费|收费|购买/i.test(msg)) {
    return { code: 'order_error', retryable: false, label: '余额或订单异常' };
  }
  if (/AI|模型|model|服务暂不可用|429|rate.?limit|service\s*unavailable|provider|上游/i.test(msg)) {
    return { code: 'ai_unavailable', retryable: true, label: 'AI 服务暂不可用' };
  }
  return { code: 'internal_error', retryable: false, label: '系统内部错误' };
}

// 可重试的错误码（与 classifyTaskError 的 retryable 对应；只有这些失败允许一键重试）
export const RETRYABLE_ERROR_CODES = new Set(['network_timeout', 'ai_unavailable']);

// 重试前置校验（不重复扣费）：
//   1) 任务属于当前用户；2) 仅 failed 且可重试；3) 原订单仍为 paid 且 service_status=failed；
// 通过后 retry_count + 1（并发防重由调用方 claimOrderExecution 的原子 UPDATE 保证）。
// 返回 { task, orderNo }，或 { error, status } 表示不可重试。
export function prepareTaskRetry(taskId, userId) {
  const task = getTaskDetail(taskId, userId);
  if (!task) return { error: '任务不存在', status: 404 };
  if (task.status !== 'failed') return { error: '仅失败任务可重试', status: 409 };
  if (!RETRYABLE_ERROR_CODES.has(task.error_code)) {
    return { error: '该错误类型不支持一键重试，请联系客服', status: 409 };
  }
  let orderNo = null;
  if (task.order_id) {
    const order = db.prepare('SELECT id, order_no, status, service_status FROM orders WHERE id = ?').get(task.order_id);
    if (!order || order.status !== 'paid') return { error: '原订单不可用，请重新下单', status: 409 };
    if (order.service_status !== 'failed') return { error: '订单服务状态异常，请重新下单', status: 409 };
    orderNo = order.order_no;
  }
  db.prepare('UPDATE ai_tasks SET retry_count = retry_count + 1 WHERE id = ?').run(taskId);
  return { task, orderNo };
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
            t.charge_type, t.amount, t.status, t.created_at, t.order_id, o.order_no,
            t.progress, t.stage, t.error_code, t.retry_count,
            LENGTH(t.input_text) as input_len, LENGTH(t.output_text) as output_len,
            SUBSTR(t.output_text, 1, 200) as output_preview,
            p.title as project_title
     FROM ai_tasks t
     LEFT JOIN projects p ON p.id = t.project_id
     LEFT JOIN orders o ON o.id = t.order_id
     ${where}
     ORDER BY t.created_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, size, offset);

  // 内容保留天数（供前端提示用户及时下载）
  const retention_days = parseInt(getSetting('doc_retention_days', '30'), 10) || 30;
  return { tasks, total, page, size, pages: Math.ceil(total / size), retention_days };
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

// 清理过期任务（与文档保留期一致，默认 30 天，由 doc_retention_days 配置控制）
export function cleanupOldTasks() {
  const days = parseInt(getSetting('doc_retention_days', '30'), 10) || 30;
  const expireAt = now() - days * 86400;
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

// 论文主流程阶段白名单（与前端 PAPER_STAGES 对齐；current_stage 只允许这些值）
export const PAPER_STAGES = ['create', 'materials', 'outline', 'literature', 'writing', 'review', 'defense', 'export'];

// 系统进度映射：每个里程碑对应的完成度（由已完成任务/产物自动推导，与用户手工标记区分）
const STAGE_PROGRESS = { create: 5, materials: 15, outline: 25, literature: 40, writing: 70, review: 85, defense: 95, export: 100 };

// 由工作区实际产物/已完成任务推导「系统进度」，与客户端可手工修改的 completion_percent 解耦。
// 证据规则（任一命中即认为该里程碑达成）：
//   materials   上传了参考材料
//   outline     大纲已确认（或已有大纲结构）
//   literature  蒸馏出文献/框架（sources.references 或 sources.framework）
//   writing     生成过章节草稿或全文
//   review      做过润色/优化/语法类审校
//   defense     生成过答辩材料
//   export      已生成全文（写作完成，具备导出交付条件）
// 返回 { percent, stage }，percent 为最高达成里程碑的完成度（下限 5%，上限 100%）。
export function computeSystemProgress(userId, projectId) {
  const p = db.prepare('SELECT id, outline_confirmed_at, outline_json, chapters_json, sources_json FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId);
  if (!p) return { percent: 0, stage: 'create' };

  let outline = []; try { outline = JSON.parse(p.outline_json || '[]'); } catch {}
  let chapters = []; try { chapters = JSON.parse(p.chapters_json || '[]'); } catch {}
  let sources = {}; try { sources = JSON.parse(p.sources_json || '{}'); } catch {}

  const materials = db.prepare('SELECT COUNT(*) AS c FROM materials WHERE project_id = ?').get(projectId).c;
  const taskFlags = db.prepare(
    `SELECT
       MAX(CASE WHEN tool_type = 'writing' AND action = 'fulltext' AND status = 'success' THEN 1 ELSE 0 END) AS fulltext,
       MAX(CASE WHEN tool_type IN ('polish','rewrite','ai_reduce','grammar') AND status = 'success' THEN 1 ELSE 0 END) AS review,
       MAX(CASE WHEN tool_type = 'defense' AND status = 'success' THEN 1 ELSE 0 END) AS defense
     FROM ai_tasks WHERE project_id = ? AND user_id = ?`
  ).get(projectId, userId);

  const evidence = {
    create: true,
    materials: materials > 0,
    outline: !!p.outline_confirmed_at || outline.length > 0,
    literature: (Array.isArray(sources.references) && sources.references.length > 0) || !!sources.framework,
    writing: chapters.length > 0 || !!taskFlags.fulltext,
    review: !!taskFlags.review,
    defense: !!taskFlags.defense,
    export: !!taskFlags.fulltext && chapters.length > 0,
  };

  let stage = 'create';
  for (const s of PAPER_STAGES) {
    if (evidence[s]) stage = s;
  }
  return { percent: STAGE_PROGRESS[stage] ?? 5, stage };
}

// 依据系统推导进度「只前进不后退」地同步 current_stage：
// 当实际产物/已完成任务已推进到更靠后的里程碑时，自动前移 current_stage；
// 若用户手工设置过更靠后的阶段，则不被回退。返回同步后的阶段（无变化返回 null）。
export function syncProjectStage(userId, projectId) {
  if (!projectId || !userId) return null;
  const sys = computeSystemProgress(userId, projectId);
  const p = db.prepare('SELECT current_stage FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId);
  if (!p) return null;
  const curIdx = PAPER_STAGES.indexOf(p.current_stage || 'create');
  const sysIdx = PAPER_STAGES.indexOf(sys.stage);
  if (sysIdx > curIdx) {
    db.prepare('UPDATE projects SET current_stage = ?, updated_at = ? WHERE id = ?').run(sys.stage, now(), projectId);
    return sys.stage;
  }
  return null;
}

// 确保用户存在对应题目的"自动工作区"：首次生成该题目的内容时自动创建（auto_created=1），
// 未显式指定工作区的 AI 生成内容按题目自动归档，防止内容散落丢失。
// 同题目重复生成复用同一工作区（按 用户+标题 匹配），不同题目各自建区。
export function ensureAutoProject(userId, title) {
  return resolveAutoProject(userId, title).id;
}

// 复用/创建自动工作区（返回更多元信息）：优先复用同名活动工作区（手动项目优先，其次自动项目），
// 避免「用户已手动建同名项目，AI 又自动建一个重复项目」的问题。
export function resolveAutoProject(userId, title) {
  const t = String(title || '').trim().slice(0, 100) || '未命名工作区';
  const existing = db.prepare(
    "SELECT id, auto_created FROM projects WHERE user_id = ? AND status = 'active' AND title = ? ORDER BY auto_created ASC, id ASC LIMIT 1"
  ).get(userId, t);
  if (existing) {
    return { id: existing.id, reused: true, title: t, auto_created: existing.auto_created };
  }
  const info = db.prepare(
    `INSERT INTO projects (user_id, title, field, description, writing_requirements, outline_json, auto_created)
     VALUES (?, ?, '', ?, '', '[]', 1)`
  ).run(userId, t, `系统自动创建：自动保存「${t}」相关的 AI 生成内容，方便随时回看`);
  return { id: info.lastInsertRowid, reused: false, title: t, auto_created: 1 };
}

export function createProject({
  userId,
  title,
  field = '',
  description = '',
  writingRequirements = '',
  outline = [],
  degree = '',
  deadline = null,
  current_stage = 'create',
  completion_percent = 0,
}) {
  const info = db.prepare(
    `INSERT INTO projects (user_id, title, field, description, writing_requirements, outline_json, degree, deadline, current_stage, completion_percent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId, title, field, description, writingRequirements, JSON.stringify(outline),
    degree || null, deadline ? Number(deadline) : null, current_stage || 'create', Number(completion_percent) || 0
  );
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
  const sys = computeSystemProgress(userId, projectId);
  p.system_progress = sys.percent;
  p.system_stage = sys.stage;
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
    const sys = computeSystemProgress(userId, p.id);
    p.system_progress = sys.percent;
    p.system_stage = sys.stage;
  }
  return projects;
}

export function updateProject(projectId, userId, updates) {
  const existing = getProject(projectId, userId);
  if (existing?.workflow_mode === 'full' && ('outline' in updates || 'outline_json' in updates)) throw new Error('请在完整论文流程中修改并确认大纲');
  const allowed = ['title', 'field', 'description', 'writing_requirements', 'outline_json', 'status', 'degree', 'deadline', 'current_stage', 'completion_percent'];
  const sets = [];
  const params = [];
  let outlineChanged = false;
  for (const [k, v] of Object.entries(updates)) {
    const col = k === 'writingRequirements' ? 'writing_requirements' : k === 'outline' ? 'outline_json' : k;
    if (!allowed.includes(col)) continue;
    if (col === 'outline_json') {
      // 大纲一旦变更，先前确认不再代表当前内容，必须由用户重新确认后才能生成全文。
      outlineChanged = true;
      sets.push(`${col} = ?`);
      params.push(JSON.stringify(Array.isArray(v) ? v : []));
      continue;
    }
    if (col === 'deadline') {
      // 截止时间为 Unix 秒级时间戳，空值清空，其余强转数字
      sets.push(`${col} = ?`);
      params.push(v ? Number(v) : null);
      continue;
    }
    if (col === 'completion_percent') {
      // 完成度 0–100 整数：非法值抛 400（不静默归零），防客户端伪造任意进度
      const pct = Number(v);
      if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
        const e = new Error('完成度必须在 0–100 之间');
        e.statusCode = 400;
        throw e;
      }
      sets.push(`${col} = ?`);
      params.push(pct);
      continue;
    }
    if (col === 'current_stage') {
      // 阶段白名单：只允许 PAPER_STAGES 中的值，防客户端伪造任意阶段
      if (!PAPER_STAGES.includes(v)) {
        const e = new Error('阶段不合法');
        e.statusCode = 400;
        throw e;
      }
    }
    sets.push(`${col} = ?`);
    params.push(v);
  }
  if (sets.length === 0) return getProject(projectId, userId);
  if (outlineChanged) {
    sets.push('outline_confirmed_at = NULL');
    sets.push('final_check_json = NULL');
  }
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

// 物理删除项目及其关联材料/任务（在事务内级联）。
// 说明：generated_docs / charts 为「用户级」资源（未挂 project_id），不随项目删除，
// 仍按保留期由 cleanupOldDocs / 用户手动清理。若未来这两张表挂上 project_id 再纳入级联。
export function deleteProjectForever(projectId, userId) {
  const p = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId);
  if (!p) return false;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM materials WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM ai_tasks WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
  });
  tx();
  return true;
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
  const existing = getProject(projectId, userId);
  if (existing?.workflow_mode === 'full' && existing.workflow_state !== 'researching') throw new Error('请先返回文献核验阶段再更新研究资料');
  if (existing?.workflow_mode === 'full' && existing.chapters?.length) {
    const identities = refs => JSON.stringify((refs || []).map(r => String(r.doi || r.title || '').trim().toLowerCase()));
    if (identities(existing.sources?.references) !== identities(sources?.references)) throw new Error('已有正文引用编号绑定当前文献顺序，不能更换或重排文献；请新建项目以保留已有正文');
  }
  const r = db.prepare(
    'UPDATE projects SET sources_json = ?, updated_at = ? WHERE id = ? AND user_id = ?'
  ).run(JSON.stringify(sources || {}), now(), projectId, userId);
  if (r.changes > 0) {
    replaceDistilledEvidence(userId, projectId, sources || {});
    syncProjectStage(userId, projectId);
  }
  return r.changes > 0;
}

// 保存结构化大纲到工作区（大纲生成/深度调研后自动写入，供工作区展示与确认）
// 每次保存新大纲都要求重新确认，避免旧确认被复用于已变更的论文结构。
export function saveProjectOutline(projectId, userId, outline) {
  if (!projectId || !userId || !Array.isArray(outline) || outline.length === 0) return false;
  const existing = getProject(projectId, userId);
  if (existing?.workflow_mode === 'full' && (existing.workflow_state !== 'outline_review' || (existing.chapters?.length && JSON.stringify(existing.outline) !== JSON.stringify(outline)))) throw new Error('请在大纲确认阶段操作，已生成正文的结构需保留');
  const r = db.prepare(
    'UPDATE projects SET outline_json = ?, outline_confirmed_at = NULL, final_check_json = NULL, updated_at = ? WHERE id = ? AND user_id = ?'
  ).run(JSON.stringify(outline), now(), projectId, userId);
  if (r.changes > 0) syncProjectStage(userId, projectId);
  return r.changes > 0;
}

// ========== 上下文组装 ==========

// 从论文工作区提取上下文，注入到 AI 调用的 prompt 中
// 策略：
//   1. 论文标题 + 学科 + 写作要求（基础信息，必带）
//   2. 大纲（如果存在，带结构）
//   3. 同工作区最近的相关任务输出（智能截断，不超过 MAX_CONTEXT_CHARS）
// 安全：必须校验 userId 归属，防止跨用户读取他人工作区数据（IDOR）
export function buildProjectContext(projectId, userId, { currentToolType = '', maxChars = MAX_CONTEXT_CHARS } = {}) {
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

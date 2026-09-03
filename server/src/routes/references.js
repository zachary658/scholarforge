import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../middleware.js';
import { formatReference } from '../ai.js';
import { logUsage } from '../usage.js';
import { checkTextLength, TEXT_MAX_SHORT } from '../utils.js';
import logger from '../logger.js';
import { replaceEvidenceSource, removeEvidenceSource } from '../services/evidence-engine.js';
import { searchMultiSource } from '../services/multi-source-search.js';
import { isZoteroConfigured, searchByIdentifier, importBibliography } from '../services/zotero-client.js';
import { classifyReferenceSearch, shouldCacheReferenceSearch } from '../services/research-quality.js';

const router = Router();

function ownedProjectId(value, userId) {
  if (value === undefined || value === null || value === '') return null;
  const projectId = Number.parseInt(value, 10);
  if (!Number.isInteger(projectId) || projectId <= 0 || String(projectId) !== String(value).trim()) return false;
  return db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId)?.id || false;
}

// 检索结果缓存（相同关键词 24 小时，内存缓存；进程内有效）
const searchCache = new Map(); // key -> { data, at }
const SEARCH_CACHE_TTL = 24 * 3600 * 1000;

// 免费不限次功能的每用户每小时调用上限：文献检索调用真实外部学术 API，
// 免费不意味着可被批量注册后无限刷（此前限流只覆盖大纲，ref_search 完全无限制）
const REF_SEARCH_HOURLY_LIMIT = 30;

function isRefSearchRateLimited(userId) {
  const cutoff = Math.floor(Date.now() / 1000) - 3600;
  const cnt = db.prepare(
    "SELECT COUNT(*) as c FROM usage_logs WHERE user_id = ? AND tool_type = 'ref_search' AND created_at >= ?"
  ).get(userId, cutoff).c;
  return cnt >= REF_SEARCH_HOURLY_LIMIT;
}

// 文献检索（OpenAlex / Semantic Scholar / CrossRef / arXiv / 可选 CNKI）
router.get('/search', authRequired, async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  // 无查询参数时不调用 API，直接返回空数组
  if (!q) {
    return res.json({
      results: [],
      total: 0,
      note: '检索结果来自 OpenAlex、CrossRef、Semantic Scholar、arXiv 等公开学术数据库，并优先展示可溯源记录',
    });
  }

  // 相同关键词缓存 24 小时
  const cacheKey = q.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL) {
    return res.json({ ...cached.data, cached: true });
  }

  // 免费不限次限流：命中缓存不计，真实外部 API 调用按用户每小时限流
  if (isRefSearchRateLimited(req.user.id)) {
    return res.status(429).json({ error: '检索过于频繁，请 1 小时后再试', results: [], total: 0 });
  }

  try {
    const search = await searchMultiSource(q, { limit: 20 });
    const results = (search.results || []).map((work) => ({
      ...work,
      source: 'web',
      ref_type: work.ref_type || 'journal',
      publisher: work.publisher || '',
    }));
    const sources_used = search.sources_used || [];
    const warnings = search.errors || [];
    const health = classifyReferenceSearch({ results, sources_used, errors: warnings });
    const payload = {
      results,
      total: results.length,
      sources_used,
      warnings,
      health,
      note: '结果来自 OpenAlex、CrossRef、Semantic Scholar、arXiv 等多个公开学术数据库，并按主题相关度、可溯源性与学术影响力综合排序',
    };
    // 故障与部分覆盖结果不进入 24 小时缓存，避免外部来源恢复后用户仍看到旧状态。
    if (shouldCacheReferenceSearch(health)) {
      searchCache.set(cacheKey, { data: payload, at: Date.now() });
      if (searchCache.size > 200) {
        const firstKey = searchCache.keys().next().value;
        searchCache.delete(firstKey);
      }
    }
    // 记录本次检索（供每用户每小时限流计数）
    logUsage({
      userId: req.user.id,
      toolType: 'ref_search',
      action: 'search',
      model: { name: 'multi-source' },
      inputChars: q.length,
      outputChars: 0,
      tokens: 0,
      status: 'success',
      chargeType: 'unlimited',
      amount: 0,
    });
    return res.json(payload);
  } catch (err) {
    logger.error('references', `多源文献检索失败: ${err && err.message ? err.message : String(err)}`);
    return res.status(502).json({
      error: '无法连接学术文献检索服务，请稍后重试',
      results: [],
      total: 0,
      sources_used: [],
      warnings: [],
      health: 'unavailable',
    });
  }
});

// 我的文献列表
router.get('/', authRequired, (req, res) => {
  const projectId = ownedProjectId(req.query.projectId, req.user.id);
  if (projectId === false) return res.status(404).json({ error: '工作区不存在' });
  const refs = projectId
    ? db.prepare('SELECT * FROM "references" WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC').all(req.user.id, projectId)
    : db.prepare('SELECT * FROM "references" WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ references: refs });
});

// 添加文献（手动或从检索收藏）
router.post('/', authRequired, (req, res) => {
  const { title, authors, year, journal, publisher, ref_type, doi, source, source_url, source_db, abstract, projectId: requestedProjectId, project_id } = req.body || {};
  if (!title) return res.status(400).json({ error: '请填写文献标题' });
  // 入库长度校验：短文本 ≤200（作者列表放宽至 500，兼容多作者论文），原文链接 ≤2048，超限 400
  const lenErr = checkTextLength([
    { value: title, label: '文献标题', max: TEXT_MAX_SHORT },
    { value: authors, label: '作者', max: 500 },
    { value: year, label: '年份', max: TEXT_MAX_SHORT },
    { value: journal, label: '期刊', max: TEXT_MAX_SHORT },
    { value: publisher, label: '出版社', max: TEXT_MAX_SHORT },
    { value: ref_type, label: '文献类型', max: TEXT_MAX_SHORT },
    { value: doi, label: 'DOI', max: TEXT_MAX_SHORT },
    { value: source, label: '来源', max: TEXT_MAX_SHORT },
    { value: source_db, label: '来源数据库', max: TEXT_MAX_SHORT },
    { value: source_url, label: '原文链接', max: 2048 },
    { value: abstract, label: '摘要', max: 10000 },
  ]);
  if (lenErr) return res.status(400).json({ error: lenErr });
  // source_url 协议白名单：仅允许 http/https 开头（与前端校验一致，后端兜底拦截 javascript: 等危险协议）
  if (source_url && !/^https?:\/\//i.test(String(source_url))) {
    return res.status(400).json({ error: '原文链接仅支持 http/https 协议' });
  }
  const linkedProjectId = ownedProjectId(requestedProjectId ?? project_id, req.user.id);
  if (linkedProjectId === false) return res.status(404).json({ error: '工作区不存在' });
  const info = db
    .prepare(
      `INSERT INTO "references" (user_id, project_id, title, authors, year, journal, publisher, ref_type, doi, source, source_url, source_db, abstract)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      linkedProjectId || null,
      title,
      authors || '',
      year || '',
      journal || '',
      publisher || '',
      ref_type || 'journal',
      doi || '',
      source || 'manual',
      source_url || '',
      source_db || (source === 'web' ? '用户收藏' : '手动添加'),
      abstract || ''
    );
  const ref = db.prepare('SELECT * FROM "references" WHERE id = ?').get(info.lastInsertRowid);
  if (linkedProjectId) {
    replaceEvidenceSource({
      userId: req.user.id,
      projectId: linkedProjectId,
      sourceType: 'reference',
      sourceId: ref.id,
      sourceTitle: ref.title,
      text: [ref.title, ref.abstract].filter(Boolean).join('\n\n'),
      metadata: { authors: ref.authors, year: ref.year, doi: ref.doi, source_url: ref.source_url, source_db: ref.source_db },
      traceable: Boolean(ref.doi || ref.source_url),
    });
  }
  res.json({ reference: ref });
});

// 兼容旧字段 source_db 未持久化的情况：补一个查询字段
// (source_db 字段已在 db.js 迁移中添加)

router.delete('/:id', authRequired, (req, res) => {
  const ref = db.prepare('SELECT id, project_id FROM "references" WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!ref) return res.status(404).json({ error: '文献不存在' });
  removeEvidenceSource({ userId: req.user.id, projectId: ref.project_id, sourceType: 'reference', sourceId: ref.id });
  db.prepare('DELETE FROM "references" WHERE id = ?').run(ref.id);
  res.json({ ok: true });
});

// 批量格式化（支持 GB/T 7714 / APA / MLA）
router.post('/format', authRequired, (req, res) => {
  const { style = 'gbt7714', ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: '请选择需要格式化的文献' });
  }
  // 数量上限：防一次传入海量 id 构造超长 IN 子句（SQLite 变量数上限约 999）
  if (ids.length > 200) return res.status(400).json({ error: '单次最多格式化 200 条文献' });
  const placeholders = ids.map(() => '?').join(',');
  const refs = db
    .prepare(`SELECT * FROM "references" WHERE user_id = ? AND id IN (${placeholders})`)
    .all(req.user.id, ...ids);
  const formatted = refs.map((r) => ({ id: r.id, raw: r, formatted: formatReference({ ref: r, style }) }));
  res.json({ style, formatted });
});

// 单条格式化预览
router.post('/format-preview', authRequired, (req, res) => {
  const { ref, style = 'gbt7714' } = req.body || {};
  if (!ref || !ref.title) return res.status(400).json({ error: '文献信息不完整' });
  res.json({ formatted: formatReference({ ref, style }) });
});

// 从 Zotero Translation Server 导入文献（可选插件）
// 支持两种模式：identifier（DOI/PMID/ISBN/arXiv/URL 单条识别）、bibliography（BibTeX/RIS 批量）
// 未配置 ZOTERO_TRANSLATION_URL 时返回明确提示，不阻断主流程。
router.post('/import', authRequired, async (req, res) => {
  try {
    if (!isZoteroConfigured()) {
      return res.status(501).json({ error: 'Zotero 导入通道未启用：请配置 ZOTERO_TRANSLATION_URL' });
    }
    const { identifier, bibliography, projectId: requestedProjectId, project_id } = req.body || {};
    const linkedProjectId = ownedProjectId(requestedProjectId ?? project_id, req.user.id);
    if (requestedProjectId != null && linkedProjectId === false) {
      return res.status(404).json({ error: '工作区不存在' });
    }
    // 批量书目优先；否则单条标识符识别
    const items = bibliography
      ? await importBibliography(bibliography)
      : identifier
        ? [await searchByIdentifier(identifier)]
        : null;
    if (items == null) return res.status(400).json({ error: '请提供 identifier 或 bibliography' });

    // 入库（复用 POST / 的字段与长度校验逻辑，逐条落库）
    const created = [];
    for (const item of items) {
      if (!item || !item.title) continue;
      const lenErr = checkTextLength([
        { value: item.title, label: '文献标题', max: TEXT_MAX_SHORT },
        { value: item.authors, label: '作者', max: 500 },
        { value: item.journal, label: '期刊', max: TEXT_MAX_SHORT },
        { value: item.doi, label: 'DOI', max: TEXT_MAX_SHORT },
        { value: item.source_url, label: '原文链接', max: 2048 },
      ]);
      if (lenErr) continue;
      const info = db
        .prepare(
          `INSERT INTO "references" (user_id, project_id, title, authors, year, journal, publisher, ref_type, doi, source, source_url, source_db, abstract)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          req.user.id,
          linkedProjectId || null,
          item.title,
          item.authors || '',
          item.year || '',
          item.journal || '',
          '',
          item.item_type || 'journal',
          item.doi || '',
          'zotero',
          item.source_url || '',
          'zotero',
          ''
        );
      const ref = db.prepare('SELECT * FROM "references" WHERE id = ?').get(info.lastInsertRowid);
      if (linkedProjectId) {
        replaceEvidenceSource({
          userId: req.user.id,
          projectId: linkedProjectId,
          sourceType: 'reference',
          sourceId: ref.id,
          sourceTitle: ref.title,
          text: [ref.title, ref.abstract].filter(Boolean).join('\n\n'),
          metadata: { authors: ref.authors, year: ref.year, doi: ref.doi, source_url: ref.source_url, source_db: 'zotero' },
          traceable: Boolean(ref.doi || ref.source_url),
        });
      }
      created.push(ref);
    }
    res.json({ imported: created.length, references: created });
  } catch (err) {
    logger.warn('references-import', `Zotero 导入失败: ${err.message}`);
    res.status(502).json({ error: `Zotero 导入失败：${err.message}` });
  }
});

export default router;

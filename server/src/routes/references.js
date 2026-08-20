import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../middleware.js';
import { formatReference } from '../ai.js';
import { getSetting } from '../config-store.js';
import logger from '../logger.js';

const router = Router();

// 检索结果缓存（相同关键词 24 小时，内存缓存；进程内有效）
const searchCache = new Map(); // key -> { data, at }
const SEARCH_CACHE_TTL = 24 * 3600 * 1000;
const SEARCH_TIMEOUT = 10000; // 10 秒超时

// OpenAlex API 邮箱（进入 polite pool，可经配置覆盖；默认使用产品邮箱）
function getOpenAlexMailto() {
  return getSetting('openalex_mailto', 'scholarforge@test.com') || 'scholarforge@test.com';
}

// 将 OpenAlex 的倒排索引摘要还原为纯文本
function decodeInvertedIndex(inv) {
  if (!inv || typeof inv !== 'object') return '';
  const positions = [];
  for (const [word, idxs] of Object.entries(inv)) {
    if (!Array.isArray(idxs)) continue;
    for (const i of idxs) positions.push({ i, word });
  }
  if (positions.length === 0) return '';
  positions.sort((a, b) => a.i - b.i);
  return positions.map((p) => p.word).join(' ');
}

// OpenAlex 文献类型 -> 系统 ref_type
function mapRefType(type) {
  switch (type) {
    case 'article':
      return 'journal';
    case 'book-chapter':
    case 'book':
      return 'book';
    case 'thesis':
      return 'thesis';
    default:
      return 'journal';
  }
}

// 将单个 OpenAlex work 映射为系统既有格式（真实可溯源）
function mapWork(work) {
  const authorships = Array.isArray(work.authorships) ? work.authorships : [];
  const authors = authorships
    .map((a) => a && a.author && a.author.display_name)
    .filter(Boolean)
    .join(', ');

  // 期刊/来源名称：优先 primary_location.source，回退 host_venue
  const source =
    (work.primary_location && work.primary_location.source && work.primary_location.source.display_name) ||
    (work.host_venue && work.host_venue.display_name) ||
    '';

  // DOI 规范化：OpenAlex 返回形如 https://doi.org/10.xxx，系统内存放裸 DOI
  let doi = '';
  if (work.doi && typeof work.doi === 'string') {
    doi = work.doi.replace(/^https?:\/\/doi\.org\//i, '');
  }

  // 可溯源链接：优先 DOI，其次 OA PDF，其次 landing page，最后 OpenAlex work id
  const bestOa = work.best_oa_location || {};
  let sourceUrl = '';
  if (doi) sourceUrl = `https://doi.org/${doi}`;
  else if (bestOa.pdf_url) sourceUrl = bestOa.pdf_url;
  else if (bestOa.landing_page_url) sourceUrl = bestOa.landing_page_url;
  else if (work.id) sourceUrl = work.id;

  const abstract = decodeInvertedIndex(work.abstract_inverted_index);
  const isBook = ['book', 'book-chapter'].includes(work.type);

  return {
    title: work.title || work.display_name || '(无标题)',
    authors: authors || '佚名',
    year: work.publication_year ? String(work.publication_year) : '',
    journal: isBook ? '' : source,
    publisher: isBook ? source : '',
    ref_type: mapRefType(work.type),
    doi,
    source: 'web',
    source_url: sourceUrl,
    source_db: 'OpenAlex',
    abstract,
    cited_by_count: work.cited_by_count || 0,
    openalex_id: work.id || '',
  };
}

// 文献检索（调用 OpenAlex API，真实可溯源）
router.get('/search', authRequired, async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  // 无查询参数时不调用 API，直接返回空数组
  if (!q) {
    return res.json({
      results: [],
      total: 0,
      note: '所有检索结果均来自 OpenAlex 真实学术数据库，可溯源至原文链接',
    });
  }

  const mailto = getOpenAlexMailto();
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(q)}&mailto=${encodeURIComponent(mailto)}&per-page=20`;

  // 相同关键词缓存 24 小时
  const cacheKey = q.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL) {
    return res.json({ ...cached.data, cached: true });
  }

  const doFetch = () => fetch(url, {
    headers: { 'User-Agent': `ScholarForge/1.0 (mailto:${mailto})` },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT),
  });

  try {
    let resp;
    try {
      resp = await doFetch();
    } catch (firstErr) {
      // 超时/网络错误：重试一次
      logger.warn('references', `OpenAlex 首次请求失败，重试一次: ${firstErr && firstErr.message ? firstErr.message : String(firstErr)}`);
      resp = await doFetch();
    }
    if (!resp.ok) {
      return res.status(502).json({
        error: `OpenAlex 服务返回异常（${resp.status}），请稍后重试`,
        results: [],
        total: 0,
      });
    }
    const data = await resp.json();
    const works = Array.isArray(data.results) ? data.results : [];
    const results = works.map(mapWork);
    const payload = {
      results,
      total: results.length,
      note: '所有检索结果均来自 OpenAlex 真实学术数据库，可溯源至原文链接',
    };
    searchCache.set(cacheKey, { data: payload, at: Date.now() });
    if (searchCache.size > 200) {
      const firstKey = searchCache.keys().next().value;
      searchCache.delete(firstKey);
    }
    return res.json(payload);
  } catch (err) {
    logger.error('references', `OpenAlex 检索失败: ${err && err.message ? err.message : String(err)}`);
    return res.status(502).json({
      error: '无法连接 OpenAlex 文献检索服务，请检查网络后重试',
      results: [],
      total: 0,
    });
  }
});

// 我的文献列表
router.get('/', authRequired, (req, res) => {
  const refs = db
    .prepare('SELECT * FROM "references" WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  res.json({ references: refs });
});

// 添加文献（手动或从检索收藏）
router.post('/', authRequired, (req, res) => {
  const { title, authors, year, journal, publisher, ref_type, doi, source, source_url, source_db } = req.body || {};
  if (!title) return res.status(400).json({ error: '请填写文献标题' });
  const info = db
    .prepare(
      `INSERT INTO "references" (user_id, title, authors, year, journal, publisher, ref_type, doi, source, source_url, source_db)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      title,
      authors || '',
      year || '',
      journal || '',
      publisher || '',
      ref_type || 'journal',
      doi || '',
      source || 'manual',
      source_url || '',
      source_db || (source === 'web' ? '用户收藏' : '手动添加')
    );
  const ref = db.prepare('SELECT * FROM "references" WHERE id = ?').get(info.lastInsertRowid);
  res.json({ reference: ref });
});

// 兼容旧字段 source_db 未持久化的情况：补一个查询字段
// (source_db 字段已在 db.js 迁移中添加)

router.delete('/:id', authRequired, (req, res) => {
  const ref = db.prepare('SELECT id FROM "references" WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!ref) return res.status(404).json({ error: '文献不存在' });
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

export default router;

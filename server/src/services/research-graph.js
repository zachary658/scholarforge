// 深度研究流程编排（LangGraph 语义状态机）
//
// 把 smartWriting（paper-distillation.js）的「多视角—检索—蒸馏—大纲—生成」手工串联
// 重构为可持久化、可单节点重试、可增量重跑的节点图。方案优先级 6：只替换深度研究
// 流程编排，不替换 Express 后端。
//
// 节点图（方案指定）：
//   题目分析 → 检索计划 → 多源检索 → 全文获取 → 解析索引 → 证据筛选
//   → [确认大纲] → 分章生成 → 引用核验 → 事实审校 → 导出
//
// 关键收益：
//   - 某篇 PDF 解析失败 → 只重跑「解析索引」节点，不需要整条任务重来；
//   - 用户修改大纲 → 只重跑「分章生成」及之后的节点（受影响章节）；
//   - 每步产出落 state，可做断点续跑与进度上报。
//
// 兼容性：smartWriting 仍是默认入口；本模块提供 runResearchGraph 作为可选的新编排层。
// 各节点复用 paper-distillation 的纯函数（discoverPerspectives / searchMultiSource /
// enrichSourcesFromOpenAccess / extractFramework / mergeFrameworks / buildFrameworkContext）。
import { createStateGraph } from './graph-core.js';
import { searchMultiSource } from './multi-source-search.js';
import {
  discoverPerspectives,
  extractFramework,
  mergeFrameworks,
  buildFrameworkContext,
  enrichSourcesFromOpenAccess,
  extractBenchmarkData,
} from './paper-distillation.js';
import { runAI } from '../ai-service.js';
import { dedupKeyOf } from '../utils.js';
import logger from '../logger.js';

// 跨视角去重（与 paper-distillation.dedupePapers 一致，保留 Unicode 标题）
function dedupePapers(papers) {
  const seen = new Map();
  for (const p of papers) {
    const key = p._dedupKey || dedupKeyOf(p.title);
    if (!key) continue;
    if (seen.has(key)) {
      const ex = seen.get(key);
      if (!ex.abstract && p.abstract) ex.abstract = p.abstract;
      if (p.cited_by_count > ex.cited_by_count) ex.cited_by_count = p.cited_by_count;
      if (!ex.pdf_url && p.pdf_url) ex.pdf_url = p.pdf_url;
    } else {
      seen.set(key, { ...p });
    }
  }
  return [...seen.values()].sort((a, b) => b.cited_by_count - a.cited_by_count);
}

/**
 * 构建深度研究流程状态机。
 * @param {object} params { topic, field, keywords, projectId, userId, onProgress? }
 * @returns {Promise<object>} 最终 state（含 outline/references/framework/chapters 等）
 */
export async function runResearchGraph(params) {
  const { topic, field, keywords = '', onProgress } = params;
  const progress = (stage, percent) => onProgress?.(stage, percent);

  const g = createStateGraph({ topic, field, keywords, errors: [] });

  // 1. 题目分析（含多视角发现）
  g.addNode('analyze', async (state) => {
    progress('题目分析', 5);
    const tokenAcc = state.tokenAcc || { promptTokens: 0, completionTokens: 0 };
    const perspectives = await discoverPerspectives(topic, field, tokenAcc);
    return { perspectives, tokenAcc };
  });

  // 2. 检索计划（基于视角生成检索词；这里直接沿用视角作为查询）
  g.addNode('plan', async (state) => {
    progress('检索计划', 15);
    const queries = (state.perspectives || []).map((view) => `${topic} ${view}${keywords ? ' ' + keywords : ''}`);
    return { queries };
  });

  // 3. 多源检索（分视角并行，任一视角失败不影响整体）
  g.addNode('retrieve', async (state) => {
    progress('多源检索', 30);
    const perView = await Promise.all((state.queries || []).map(async (query, i) => {
      try {
        const { results, sources_used, errors } = await searchMultiSource(query, { limit: 4 });
        return { view: state.perspectives[i], papers: results, sources_used, errors };
      } catch (err) {
        return { view: state.perspectives[i], papers: [], sources_used: [], errors: [String(err.message || err)] };
      }
    }));
    const papers = dedupePapers(perView.flatMap((v) => v.papers.map((p) => ({ ...p, _view: v.view })))).slice(0, 12);
    return {
      papers,
      sources_used: [...new Set(perView.flatMap((v) => v.sources_used))],
      errors: [...new Set([...(state.errors || []), ...perView.flatMap((v) => v.errors)])],
    };
  }, { retry: 2 });

  // 4. 全文获取 + 5. 解析索引（OA PDF 富集；失败静默降级——本节点失败只影响数据套用，不阻断主流程）
  g.addNode('fetch_index', async (state) => {
    progress('全文获取与解析', 45);
    try {
      const benchmarks = extractBenchmarkData(state.papers || []);
      const enriched = await enrichSourcesFromOpenAccess(state.papers || [], benchmarks);
      return { benchmarks: enriched.benchmarks, dataTables: enriched.tables };
    } catch (err) {
      logger.warn('research-graph', `全文富集失败（忽略）: ${err.message}`);
      return { benchmarks: extractBenchmarkData(state.papers || []), dataTables: [] };
    }
  }, { retry: 1 });

  // 6. 证据筛选 + 蒸馏（Map/Reduce）
  g.addNode('distill', async (state) => {
    progress('证据筛选与蒸馏', 60);
    const papersForMap = (state.papers || []).slice(0, 8);
    const tokenAcc = state.tokenAcc || { promptTokens: 0, completionTokens: 0 };
    const frameworks = [];
    for (let i = 0; i < papersForMap.length; i += 4) {
      const batch = papersForMap.slice(i, i + 4);
      const batchFrameworks = await Promise.all(batch.map(async (p) => {
        const f = await extractFramework(p, tokenAcc).catch(() => null);
        if (f) f.perspective = p._view || '综合';
        return f;
      }));
      frameworks.push(...batchFrameworks.filter(Boolean));
    }
    const framework = mergeFrameworks(frameworks);
    return { framework, tokenAcc };
  });

  // 7. 大纲生成（融合框架 + 真实文献 + 数据）
  g.addNode('outline', async (state) => {
    progress('生成大纲', 75);
    const references = (state.papers || []).slice(0, 8).map((p) => ({
      title: p.title, authors: p.authors, year: p.year, journal: p.journal,
      doi: p.doi, source_url: p.source_url, source_db: p.source_db, cited_by_count: p.cited_by_count,
    }));
    const context = buildFrameworkContext(state.framework, state.papers || []);
    const result = await runAI('writing', {
      type: 'outline', topic, field, context, references, benchmarks: state.benchmarks || [],
    });
    const tokenAcc = state.tokenAcc || { promptTokens: 0, completionTokens: 0 };
    tokenAcc.promptTokens += result.promptTokens || 0;
    tokenAcc.completionTokens += result.completionTokens || 0;
    return { outline: result.content, references, tokenAcc };
  }, { retry: 1 });

  // 8. 分章生成（这里由现有 chapter-service 负责；graph 只做编排占位，
  //    真正逐章生成/重跑受影响章节的能力在 chapter-service 的 regenerateChapter 已具备）
  g.addNode('chapters', async (state) => {
    progress('分章生成', 90);
    // 分章生成依赖已确认大纲 + 付费订单，由 chapter-service.startChapterGeneration 驱动；
    // graph 在此仅透传，避免与订单/计费状态机耦合（保持「不替换后端」边界）。
    return { chapters: state.chapters || [], chaptersDelegated: true };
  });

  // 9. 引用核验 + 10. 事实审校（复用 review-chain 的规则审校作为确定性把关）
  g.addNode('verify', async (state) => {
    progress('引用核验与事实审校', 95);
    const { ruleReview } = await import('./review-chain.js');
    const content = state.outline || '';
    const { errors, warnings } = ruleReview(content, state.references || []);
    return { review: { errors, warnings }, verified: errors.length === 0 };
  });

  // 11. 导出（占位；真正导出由 docx-generator / quarto-exporter 负责）
  g.addNode('export', async (state) => {
    progress('导出', 100);
    return { exported: true };
  });

  // 边
  g.setEntryPoint('analyze');
  g.addEdge('analyze', 'plan');
  g.addEdge('plan', 'retrieve');
  g.addEdge('retrieve', 'fetch_index');
  g.addEdge('fetch_index', 'distill');
  g.addEdge('distill', 'outline');
  g.addEdge('outline', 'chapters');
  g.addEdge('chapters', 'verify');
  g.addEdge('verify', 'export');
  g.setFinishPoint('export');

  const compiled = g.compile();
  return compiled.invoke({});
}

// 供上层判断：大纲修改后，只需重跑「outline → chapters → verify → export」这段受影响子图。
// 这里导出受影响节点清单，便于调用方在确认大纲后做增量重跑。
export const AFFECTED_BY_OUTLINE_CHANGE = ['chapters', 'verify', 'export'];

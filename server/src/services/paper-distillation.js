/**
 * 论文蒸馏服务（MapReduce 框架借鉴 + 原创生成）—— 编排入口与统一导出
 *
 * 流程：
 *   1. [检索] 多源聚合检索同方向论文（multi-source-search）
 *   2. [Map]  对每篇论文提取研究框架：方法/创新点/结构/关键数据
 *   3. [翻译] 外文摘要自动翻译为中文（控制 token，仅翻译摘要）
 *   4. [Reduce] 融合多个框架，生成最优结构大纲（去重+按频率排序）
 *   5. [生成] 基于融合框架 + 用户题目，分章节原创生成
 *   6. [数据套用] 提取论文中的关键数据（摘要指标 + OA 全文 PDF 表格数据），
 *      用 chart-renderer 重新绘制图表/三线表，自动标注数据来源（数据引自 XXX [n]）
 *
 * Token 成本控制：
 *   - Map 阶段：每篇仅输入摘要（300-500字），不取全文，8篇 ≈ 4000 tokens
 *   - Reduce 阶段：8个框架合并 ≈ 2000 tokens
 *   - 生成阶段：复用现有分章节生成逻辑
 *   - 总计约 1.5万输入 + 1.5万输出 ≈ 0.06元/次（DeepSeek）
 *
 * 学术伦理：
 *   - 仅借鉴研究框架和思路，不照搬原文表述
 *   - 引用真实文献（标注来源），数据借鉴标注出处
 *   - 图表/表格由代码重绘，且强制附带来源标注，避免查重与学术不端风险
 *
 * 拆分结构（本文件只保留主流程编排 smartWriting 与统一出口）：
 *   paper-distillation/framework.js       框架蒸馏（Map/Reduce/大纲结构化/上下文构建）
 *   paper-distillation/search.js          多源检索与文献核验白名单
 *   paper-distillation/data-extraction.js 指标提取 / OA PDF 下载解析 / 表格提取
 *   paper-distillation/charts.js          图表规划（vega-lite 配置与占位符替换）
 *   paper-distillation/citations.js       引用格式化（GB/T 7714 / CSL）
 */
import { searchMultiSource } from './multi-source-search.js';
import { runAI } from '../ai-service.js';
import logger from '../logger.js';
import {
  discoverPerspectives,
  extractFramework,
  mergeFrameworks,
  generateMergedStructure,
  buildFrameworkContext,
} from './paper-distillation/framework.js';
import { dedupePapers } from './paper-distillation/search.js';
import { extractBenchmarkData, enrichSourcesFromOpenAccess } from './paper-distillation/data-extraction.js';
import { benchmarksToChartConfig, replaceChartPlaceholders } from './paper-distillation/charts.js';
import { replaceCitePlaceholders } from './paper-distillation/citations.js';

// 检索失败时的通用大纲生成（降级方案）
function generateFallbackOutline(topic, field) {
  const lines = [];
  lines.push(`# ${topic}`);
  lines.push('');
  lines.push('## 第一章 绪论');
  lines.push('1.1 研究背景与意义');
  lines.push(`随着${field || '相关学科'}领域的不断发展，${topic}的研究日益受到学术界关注。`);
  lines.push('1.2 国内外研究现状');
  lines.push('1.3 研究内容与创新点');
  lines.push('1.4 论文结构安排');
  lines.push('');
  lines.push('## 第二章 相关理论与技术基础');
  lines.push('2.1 理论基础');
  lines.push('2.2 关键技术综述');
  lines.push('2.3 本章小结');
  lines.push('');
  lines.push('## 第三章 研究方法与模型设计');
  lines.push('3.1 问题定义');
  lines.push('3.2 方法框架');
  lines.push('3.3 关键模块设计');
  lines.push('3.4 本章小结');
  lines.push('');
  lines.push('## 第四章 实验设计与结果分析');
  lines.push('4.1 实验设置');
  lines.push('4.2 数据集与评价指标');
  lines.push('4.3 实验结果');
  lines.push('4.4 消融实验');
  lines.push('4.5 本章小结');
  lines.push('');
  lines.push('## 第五章 总结与展望');
  lines.push('5.1 研究总结');
  lines.push('5.2 不足与展望');
  lines.push('');
  lines.push('---');
  lines.push('*注：当前为通用大纲模板。文献检索失败，建议检查网络连接后重试以获取基于真实文献的个性化大纲。*');
  return lines.join('\n');
}

// ===== 主流程：智能写作（多视角检索 → 蒸馏 → 生成，借鉴 STORM 架构）=====
// 与单轮 MapReduce 的区别：先拆分 3-5 个研究视角，分视角检索蒸馏，
// 跨视角去重融合后生成大纲——覆盖维度更全，避免单查询检索偏差。
/**
 * @param {object} params { topic, field, keywords, projectId, userId }
 * @returns {Promise<{outline, references, framework, tokens, content}>}
 */
export async function smartWriting(params) {
  const { topic, field, keywords } = params;
  const tokenAcc = { promptTokens: 0, completionTokens: 0 };

  // 0. 多视角发现（真实 AI 生成视角，否则默认视角）
  const perspectives = await discoverPerspectives(topic, field, tokenAcc);

  // 1. 分视角并行检索（每视角 4 篇，任一视角失败不影响整体）
  const perView = await Promise.all(perspectives.map(async (view) => {
    const query = `${topic} ${view}${keywords ? ' ' + keywords : ''}`;
    try {
      const { results, sources_used, errors } = await searchMultiSource(query, { limit: 4 });
      return { view, papers: results, sources_used, errors };
    } catch (err) {
      return { view, papers: [], sources_used: [], errors: [String(err.message || err)] };
    }
  }));

  // 2. 跨视角去重合并（Map 成本控制：最多 12 篇入池、8 篇蒸馏）
  const mergedPapers = dedupePapers(perView.flatMap((v) => v.papers.map((p) => ({ ...p, _view: v.view })))).slice(0, 12);
  const errors = [...new Set(perView.flatMap((v) => v.errors))];
  const sources_used = [...new Set(perView.flatMap((v) => v.sources_used))];

  // 检索失败降级：所有视角都失败时，使用通用模板生成（不抛错，保证用户体验）
  if (mergedPapers.length === 0) {
    logger.warn('paper-distillation', `所有检索源失败或返回空结果，降级为通用模板生成。错误: ${errors.join('; ')}`);
    const fallbackOutline = generateFallbackOutline(topic, field);
    return {
      outline: fallbackOutline,
      references: [],
      framework: {
        methods: [],
        innovations: [],
        conclusions: [],
        structure: generateMergedStructure([]),
        perspectives: [],
        perspectives_used: perspectives,
        paperCount: 0,
        sources_used,
        search_errors: errors,
        degraded: true,
      },
      benchmarks: null,
      tables: [],
      degraded: true,
      tokens: { promptTokens: tokenAcc.promptTokens, completionTokens: tokenAcc.completionTokens },
    };
  }

  // 3. 构建真实文献/数据
  const references = mergedPapers.slice(0, 8).map((p) => ({
    title: p.title,
    authors: p.authors,
    year: p.year,
    journal: p.journal,
    doi: p.doi,
    source_url: p.source_url,
    source_db: p.source_db,
    cited_by_count: p.cited_by_count,
  }));
  const benchmarks = extractBenchmarkData(mergedPapers);

  // 3.5 数据套用富集：OA 全文 PDF 提取指标与表格（失败静默降级，不阻断主流程）
  let enrichedBenchmarks = benchmarks;
  let dataTables = [];
  try {
    const enriched = await enrichSourcesFromOpenAccess(mergedPapers, benchmarks);
    enrichedBenchmarks = enriched.benchmarks;
    dataTables = enriched.tables;
  } catch (err) {
    logger.warn('paper-distillation', `OA PDF 富集阶段失败（忽略，仅用摘要数据）: ${err.message}`);
  }

  // 4. Map 阶段：提取每篇论文框架（并行限流；每篇标记来源视角）
  const frameworks = [];
  const batchSize = 4; // 并发4个，平衡速度与API限流
  const papersForMap = mergedPapers.slice(0, 8); // 蒸馏成本控制：最多 8 篇
  for (let i = 0; i < papersForMap.length; i += batchSize) {
    const batch = papersForMap.slice(i, i + batchSize);
    const batchFrameworks = await Promise.all(batch.map(async (p) => {
      const f = await extractFramework(p, tokenAcc).catch(() => null);
      if (f) f.perspective = p._view || '综合';
      return f;
    }));
    frameworks.push(...batchFrameworks.filter(Boolean));
  }

  // 5. Reduce 阶段：融合框架（含视角分组）
  const mergedFramework = mergeFrameworks(frameworks);

  // 6. 真实 benchmark 图表配置
  const benchmarkChart = benchmarksToChartConfig(enrichedBenchmarks, '准确率') || benchmarksToChartConfig(enrichedBenchmarks, 'Dice');

  // 7. 生成大纲（基于融合框架 + 真实文献 + 真实数据，禁止编造引用与数据）
  const outlineResult = await runAI('writing', {
    type: 'outline',
    topic,
    field,
    context: buildFrameworkContext(mergedFramework, mergedPapers),
    references,
    benchmarks: enrichedBenchmarks,
  });
  tokenAcc.promptTokens += outlineResult.promptTokens || 0;
  tokenAcc.completionTokens += outlineResult.completionTokens || 0;

  return {
    // 大纲同样经过占位符替换（引用编号 + 数据图表由代码生成）
    outline: replaceChartPlaceholders(replaceCitePlaceholders(outlineResult.content, references), enrichedBenchmarks),
    references,
    framework: {
      methods: mergedFramework.methods,
      innovations: mergedFramework.innovations,
      conclusions: mergedFramework.conclusions,
      structure: mergedFramework.structure,
      perspectives: mergedFramework.perspectives,
      perspectives_used: perspectives,
      paperCount: mergedFramework.paperCount,
      sources_used,
      search_errors: errors,
    },
    // 套用的实验数据 + 图表配置（前端可直接渲染，或注入到生成的论文中）
    benchmarks: benchmarkChart ? { data: enrichedBenchmarks, chartConfig: benchmarkChart } : null,
    // 套用的表格数据（分章节生成时注入上下文，三线表由 docx-generator 渲染）
    tables: dataTables,
    // 真实 token 用量（供按真实用量结算）
    tokens: { promptTokens: tokenAcc.promptTokens, completionTokens: tokenAcc.completionTokens },
    // 降级模式：未配置真实 AI 时，框架提取为规则匹配、大纲为模板生成，需提示用户
    degraded: !outlineResult.usedRealAI,
  };
}

// ===== 对外统一出口（保持拆分前的公共 API 不变，存量 import 无需调整） =====
export {
  extractFramework,
  discoverPerspectives,
  mergeFrameworks,
  generateMergedStructure,
  outlineTextToStructure,
  buildFrameworkContext,
} from './paper-distillation/framework.js';
export {
  collectWritingSources,
  isVerifiedWritingReference,
  filterVerifiedWritingReferences,
  dedupePapers,
} from './paper-distillation/search.js';
export {
  extractMetricsFromText,
  extractBenchmarkData,
  downloadPdfBytes,
  tablesFromMinerUData,
  htmlTableToRows,
  parsePdfViaPdfjs,
  extractDataTables,
  enrichSourcesFromOpenAccess,
} from './paper-distillation/data-extraction.js';
export {
  benchmarksToChartConfig,
  replaceChartPlaceholders,
  ensureGroundedVisuals,
} from './paper-distillation/charts.js';
export {
  formatReferencesGB,
  replaceCitePlaceholders,
  replaceCitePlaceholdersCsl,
} from './paper-distillation/citations.js';

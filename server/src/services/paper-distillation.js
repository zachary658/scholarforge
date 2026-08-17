/**
 * 论文蒸馏服务（MapReduce 框架借鉴 + 原创生成）
 *
 * 流程：
 *   1. [检索] 多源聚合检索同方向论文（multi-source-search）
 *   2. [Map]  对每篇论文提取研究框架：方法/创新点/结构/关键数据
 *   3. [翻译] 外文摘要自动翻译为中文（控制 token，仅翻译摘要）
 *   4. [Reduce] 融合多个框架，生成最优结构大纲（去重+按频率排序）
 *   5. [生成] 基于融合框架 + 用户题目，分章节原创生成
 *   6. [数据借鉴] 提取论文中的关键数据，用 chart-renderer 重新生成图表
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
 *   - 生成内容为原创，查重友好
 */
import { searchMultiSource } from './multi-source-search.js';
import { runAI } from '../ai-service.js';
import { getDefaultModel } from '../config-store.js';
import logger from '../logger.js';

// ===== 判断是否配置了真实 AI =====
// 结果缓存 60s：默认模型配置变更频率低，避免 Map 阶段每篇论文重复查 DB
let _hasRealAICache = null;
let _hasRealAICacheAt = 0;
function hasRealAI() {
  const now = Date.now();
  if (_hasRealAICache !== null && now - _hasRealAICacheAt < 60_000) return _hasRealAICache;
  const model = getDefaultModel();
  _hasRealAICache = !!(model && model.provider !== 'builtin' && model.api_key);
  _hasRealAICacheAt = now;
  return _hasRealAICache;
}

// ===== 翻译外文摘要为中文 =====
// 控制成本：仅翻译非中文摘要；有真实AI时用AI翻译，否则保留原文
// tokenAcc：可选，累计真实 token 用量（供按真实用量结算）
async function translateAbstractIfNeeded(abstract, tokenAcc) {
  if (!abstract) return '';
  // 简单判断：含中文字符则视为中文，无需翻译
  if (/[\u4e00-\u9fa5]/.test(abstract)) return abstract;
  if (!hasRealAI()) return abstract; // 无真实AI时保留原文
  try {
    const result = await runAI('translate', { text: abstract, direction: 'en2zh' });
    if (tokenAcc) {
      tokenAcc.promptTokens += result.promptTokens || 0;
      tokenAcc.completionTokens += result.completionTokens || 0;
    }
    return result.content || abstract;
  } catch {
    return abstract; // 翻译失败保留原文
  }
}

// ===== Map 阶段：单篇论文框架提取 =====
// 从摘要中提取：研究方法、创新点、主要结论、结构特征
// 有真实AI时用AI提取（更准确），否则用规则提取（关键词匹配）
async function extractFramework(paper, tokenAcc) {
  const abstract = paper.abstract || '';
  if (!abstract) {
    return {
      title: paper.title,
      methods: [],
      innovations: [],
      conclusions: [],
      structure: [],
      hasAbstract: false,
    };
  }

  // 翻译外文摘要
  const zhAbstract = await translateAbstractIfNeeded(abstract, tokenAcc);

  if (hasRealAI()) {
    // 用 AI 提取框架（JSON 模式：结构化输出，替代脆弱的正则解析）
    try {
      const result = await runAI('framework_extract', {
        topic: paper.title,
        context: `摘要：${zhAbstract}`,
      }, { type: 'json_object' });
      if (tokenAcc) {
        tokenAcc.promptTokens += result.promptTokens || 0;
        tokenAcc.completionTokens += result.completionTokens || 0;
      }
      const parsed = JSON.parse(result.content);
      return {
        title: paper.title,
        methods: Array.isArray(parsed.methods) ? parsed.methods : [],
        innovations: Array.isArray(parsed.innovations) ? parsed.innovations : [],
        conclusions: Array.isArray(parsed.conclusions) ? parsed.conclusions : [],
        structure: Array.isArray(parsed.structure) ? parsed.structure : [],
        hasAbstract: true,
      };
    } catch {
      // JSON 模式解析失败（极少数兼容服务不支持）时回退到规则提取
    }
  }

  // 规则提取（无真实AI时的回退）：从摘要中提取关键词和句子
  const sentences = zhAbstract.split(/[。.！!？?]/).filter((s) => s.trim().length > 10);
  const methods = [];
  const innovations = [];
  const conclusions = [];

  for (const s of sentences) {
    const trimmed = s.trim();
    if (/propose|present|introduce|提出|提出|构建|设计|develop|implement|method|approach|methodology/i.test(trimmed)) {
      methods.push(trimmed.slice(0, 100));
    }
    if (/novel|new|first|innovative|创新|首次|新颖|improve|enhance/i.test(trimmed)) {
      innovations.push(trimmed.slice(0, 100));
    }
    if (/result|show|demonstrate|achieve|outperform|实验|结果|表明|证明|达到|优于/i.test(trimmed)) {
      conclusions.push(trimmed.slice(0, 100));
    }
  }

  return {
    title: paper.title,
    methods: methods.slice(0, 3),
    innovations: innovations.slice(0, 2),
    conclusions: conclusions.slice(0, 2),
    structure: [], // 规则提取无法得到结构，留空
    hasAbstract: true,
  };
}

// ===== Reduce 阶段：多框架融合 =====
// 合并多篇论文的框架，去重，按出现频率排序，生成最优结构
function mergeFrameworks(frameworks) {
  // 合并并去重方法
  const methodCount = new Map();
  for (const f of frameworks) {
    for (const m of f.methods) {
      const key = m.toLowerCase().slice(0, 50);
      methodCount.set(key, (methodCount.get(key) || 0) + 1);
    }
  }
  const methods = [...methodCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);

  // 合并创新点
  const innovCount = new Map();
  for (const f of frameworks) {
    for (const i of f.innovations) {
      const key = i.toLowerCase().slice(0, 50);
      innovCount.set(key, (innovCount.get(key) || 0) + 1);
    }
  }
  const innovations = [...innovCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);

  // 合并结论
  const conclCount = new Map();
  for (const f of frameworks) {
    for (const c of f.conclusions) {
      const key = c.toLowerCase().slice(0, 50);
      conclCount.set(key, (conclCount.get(key) || 0) + 1);
    }
  }
  const conclusions = [...conclCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);

  // 生成融合结构大纲（基于学术论文标准结构 + 借鉴的方法）
  const structure = generateMergedStructure(methods, innovations);

  return { methods, innovations, conclusions, structure, paperCount: frameworks.length };
}

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

// 生成融合结构大纲
function generateMergedStructure(methods, innovations) {
  const chapters = [
    { chapter: '第一章 绪论', sections: ['1.1 研究背景与意义', '1.2 国内外研究现状', '1.3 研究内容与创新点', '1.4 论文结构安排'] },
    { chapter: '第二章 相关理论与技术基础', sections: ['2.1 理论基础', '2.2 关键技术综述', '2.3 本章小结'] },
    { chapter: '第三章 研究方法与模型设计', sections: ['3.1 问题定义', '3.2 方法框架', '3.3 关键模块设计', '3.4 本章小结'] },
    { chapter: '第四章 实验设计与结果分析', sections: ['4.1 实验设置', '4.2 数据集与评价指标', '4.3 实验结果', '4.4 消融实验', '4.5 本章小结'] },
    { chapter: '第五章 总结与展望', sections: ['5.1 研究总结', '5.2 不足与展望'] },
  ];

  // 如果有借鉴的方法，在第三章注入
  if (methods.length > 0) {
    chapters[2].sections.splice(2, 0, '3.3 借鉴方法分析（基于文献调研）');
  }
  return chapters;
}

// ===== 共享检索：多源检索 + 构建真实文献/benchmark（供智能写作与普通写作复用）=====
/**
 * 执行多源检索，并构建真实参考文献列表与真实 benchmark 数据。
 * @returns {Promise<{papers, references, benchmarks, sources_used, errors}>}
 */
export async function collectWritingSources(topic, field, keywords = '', limit = 8) {
  const query = [topic, field, keywords].filter(Boolean).join(' ');
  const { results: papers, sources_used, errors } = await searchMultiSource(query, { limit });
  const references = papers.slice(0, limit).map((p) => ({
    title: p.title,
    authors: p.authors,
    year: p.year,
    journal: p.journal,
    doi: p.doi,
    source_url: p.source_url,
    source_db: p.source_db,
    cited_by_count: p.cited_by_count,
  }));
  const benchmarks = extractBenchmarkData(papers);
  return { papers, references, benchmarks, sources_used, errors };
}

// ===== 主流程：智能写作（检索→蒸馏→生成）=====
/**
 * @param {object} params { topic, field, keywords, projectId, userId }
 * @returns {Promise<{outline, references, framework, tokens, content}>}
 */
export async function smartWriting(params) {
  const { topic, field, keywords } = params;

  // 1. 多源检索 + 构建真实文献/数据
  const { papers, references, benchmarks, sources_used, errors } = await collectWritingSources(topic, field, keywords);

  // 检索失败降级：所有源都失败时，使用通用模板生成（不抛错，保证用户体验）
  if (papers.length === 0) {
    logger.warn('paper-distillation', `所有检索源失败或返回空结果，降级为通用模板生成。错误: ${errors.join('; ')}`);
    const fallbackOutline = generateFallbackOutline(topic, field);
    return {
      outline: fallbackOutline,
      references: [],
      framework: {
        methods: [],
        innovations: [],
        conclusions: [],
        structure: generateMergedStructure([], []),
        paperCount: 0,
        sources_used,
        search_errors: errors,
        degraded: true,
      },
      benchmarks: null,
      degraded: true,
      tokens: { promptTokens: 0, completionTokens: 0 },
    };
  }

  // 2. Map 阶段：提取每篇论文框架（并行，但限制并发数避免API限流）
  const tokenAcc = { promptTokens: 0, completionTokens: 0 };
  const frameworks = [];
  const batchSize = 4; // 并发4个，平衡速度与API限流
  for (let i = 0; i < papers.length; i += batchSize) {
    const batch = papers.slice(i, i + batchSize);
    const batchFrameworks = await Promise.all(batch.map((p) => extractFramework(p, tokenAcc).catch(() => null)));
    frameworks.push(...batchFrameworks.filter(Boolean));
  }

  // 3. Reduce 阶段：融合框架
  const mergedFramework = mergeFrameworks(frameworks);

  // 4. 真实 benchmark 图表配置（真实文献/数据已在 collectWritingSources 构建）
  const benchmarkChart = benchmarksToChartConfig(benchmarks, '准确率') || benchmarksToChartConfig(benchmarks, 'Dice');

  // 5. 生成大纲（基于融合框架 + 真实文献 + 真实数据，禁止编造引用与数据）
  const outlineResult = await runAI('writing', {
    type: 'outline',
    topic,
    field,
    context: buildFrameworkContext(mergedFramework, papers),
    references,
    benchmarks,
  });
  tokenAcc.promptTokens += outlineResult.promptTokens || 0;
  tokenAcc.completionTokens += outlineResult.completionTokens || 0;

  return {
    // 大纲同样经过占位符替换（引用编号 + 数据图表由代码生成）
    outline: replaceChartPlaceholders(replaceCitePlaceholders(outlineResult.content, references), benchmarks),
    references,
    framework: {
      methods: mergedFramework.methods,
      innovations: mergedFramework.innovations,
      conclusions: mergedFramework.conclusions,
      structure: mergedFramework.structure,
      paperCount: mergedFramework.paperCount,
      sources_used,
      search_errors: errors,
    },
    // 借鉴的实验数据 + 图表配置（前端可直接渲染，或注入到生成的论文中）
    benchmarks: benchmarkChart ? { data: benchmarks, chartConfig: benchmarkChart } : null,
    // 真实 token 用量（供按真实用量结算）
    tokens: { promptTokens: tokenAcc.promptTokens, completionTokens: tokenAcc.completionTokens },
    // 降级模式：未配置真实 AI 时，框架提取为规则匹配、大纲为模板生成，需提示用户
    degraded: !outlineResult.usedRealAI,
  };
}

// 构建框架上下文（注入到AI生成的context中）
function buildFrameworkContext(framework, papers) {
  const lines = [];
  lines.push(`【文献调研结果】共参考 ${papers.length} 篇相关论文（来自 ${[...new Set(papers.map((p) => p.source_db))].join('、')}）`);
  lines.push('');
  lines.push('【主要研究方法】（按出现频率排序）');
  framework.methods.forEach((m, i) => lines.push(`${i + 1}. ${m}`));
  lines.push('');
  lines.push('【主要创新点】');
  framework.innovations.forEach((m, i) => lines.push(`${i + 1}. ${m}`));
  lines.push('');
  lines.push('【主要结论】');
  framework.conclusions.forEach((m, i) => lines.push(`${i + 1}. ${m}`));
  return lines.join('\n');
}

// ===== 数据借鉴：从论文中提取关键数据，生成图表配置 =====
// 从摘要中提取性能指标（准确率、F1、IoU等），用于生成对比图表
// 重要：数据借鉴需标注来源，图表用我们的 chart-renderer 重新生成（非直接复制原图）
export function extractBenchmarkData(papers) {
  const benchmarks = [];
  for (const p of papers) {
    const text = p.abstract || '';
    if (!text) continue;
    const metrics = [];
    // 匹配常见性能指标格式
    const patterns = [
      { regex: /(?:accuracy|ACC)\s*(?:of|=|:|达到)?\s*(\d+\.?\d*)\s*%/gi, label: '准确率' },
      { regex: /(?:dice|DSC|DICE)\s*(?:of|=|:|达到|系数)?\s*(\d+\.?\d*)\s*%?/gi, label: 'Dice' },
      { regex: /(?:iou|IoU|IOU)\s*(?:of|=|:|达到)?\s*(\d+\.?\d*)/gi, label: 'IoU' },
      { regex: /(?:f1|F1-score)\s*(?:of|=|:|达到)?\s*(\d+\.?\d*)/gi, label: 'F1' },
    ];
    for (const { regex, label } of patterns) {
      const matches = [...text.matchAll(regex)];
      for (const m of matches) {
        const val = parseFloat(m[1]);
        if (val > 0 && val <= 100) {
          metrics.push({ label, value: val > 1 ? val : val * 100, source: p.title });
        }
      }
    }
    if (metrics.length > 0) {
      benchmarks.push({
        paperTitle: p.title,
        paperYear: p.year,
        source_db: p.source_db,
        source_url: p.source_url,
        metrics,
      });
    }
  }
  return benchmarks;
}

// 将借鉴的数据转为 vega-lite 图表配置
export function benchmarksToChartConfig(benchmarks, metricLabel = '准确率') {
  const values = [];
  for (const b of benchmarks) {
    const metric = b.metrics.find((m) => m.label === metricLabel);
    if (metric) {
      const shortName = b.paperTitle.length > 20 ? b.paperTitle.slice(0, 18) + '...' : b.paperTitle;
      values.push({ method: shortName, value: metric.value, source: b.source_db });
    }
  }
  if (values.length === 0) return null;
  return {
    mark: 'bar',
    data: { values },
    encoding: {
      x: { field: 'method', type: 'nominal', title: '方法', axis: { labelAngle: -30 } },
      y: { field: 'value', type: 'quantitative', title: `${metricLabel} (%)` },
      color: { field: 'source', type: 'nominal', title: '数据来源' },
    },
    title: `各方法${metricLabel}对比（数据借鉴自参考文献）`,
  };
}

// ===== 引用与数据完整性：由代码强制生成（模型只负责语言组织） =====

// GB/T 7714 格式化参考文献列表
export function formatReferencesGB(references) {
  if (!Array.isArray(references) || references.length === 0) return '';
  return references.map((r, i) => {
    const authors = (r.authors || '佚名').replace(/\.\s*$/, '');
    const title = (r.title || '').trim();
    const journal = (r.journal || '').trim();
    const year = (r.year || '').trim();
    const doi = (r.doi || '').trim();
    let line = `[${i + 1}] ${authors}. ${title}`;
    if (journal) line += `[J]. ${journal}`;
    if (year) line += (journal ? ', ' : '. ') + year;
    if (doi) line += `. DOI: ${doi}`;
    return line.endsWith('.') ? line : line + '.';
  }).join('\n');
}

// 替换引用占位符 [CITE:n] → [n]，并追加由代码生成的参考文献列表
export function replaceCitePlaceholders(content, references) {
  if (!content) return content;
  const hasRefs = Array.isArray(references) && references.length > 0;
  let replaced = content.replace(/\[CITE:(\d+)\]/g, (_m, n) => {
    const idx = parseInt(n, 10);
    if (!hasRefs || idx < 1 || idx > references.length) return '';
    return `[${idx}]`;
  });
  if (hasRefs && !/参考文献|References/i.test(replaced)) {
    replaced = `${replaced}\n\n## 参考文献\n\n${formatReferencesGB(references)}`;
  }
  return replaced;
}

// 替换数据图表占位符 [CHART:metric] → vega 代码块（用真实 benchmark 数据）
export function replaceChartPlaceholders(content, benchmarks) {
  if (!content) return content;
  if (!Array.isArray(benchmarks) || benchmarks.length === 0) {
    return content.replace(/\[CHART:[^\]]+\]/g, '（数据待补充）');
  }
  return content.replace(/\[CHART:([^\]]+)\]/g, (_m, metric) => {
    const config = benchmarksToChartConfig(benchmarks, metric);
    if (!config) return '（数据待补充）';
    return `\n\n\`\`\`vega\n${JSON.stringify(config)}\n\`\`\`\n`;
  });
}

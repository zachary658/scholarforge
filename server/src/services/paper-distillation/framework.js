/**
 * 框架蒸馏（MapReduce + STORM 多视角）：
 *   - Map：单篇论文摘要 → 研究框架（方法/创新点/结论/结构）
 *   - 翻译：外文摘要自动翻译为中文（控制 token，仅翻译摘要）
 *   - Reduce：多框架融合（去重 + 按频率排序 + 视角分组）
 *   - 大纲结构化：大纲文本 → 工作区结构化大纲
 * 从 paper-distillation.js 拆出；主流程编排（smartWriting）仍在 paper-distillation.js。
 */
import { runAI } from '../../ai-service.js';
import { getDefaultModel } from '../../config-store.js';
import logger from '../../logger.js';

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
export async function extractFramework(paper, tokenAcc) {
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

// ===== 多视角发现（STORM 式蒸馏阶段 0） =====
// 将研究主题拆分为 3-5 个互补检索视角：真实 AI 用 JSON 模式生成，否则用默认视角
const DEFAULT_PERSPECTIVES = [
  '研究方法与模型设计',
  '数据集与实验基准',
  '应用场景与实践',
  '挑战与未来方向',
];

export async function discoverPerspectives(topic, field, tokenAcc) {
  if (hasRealAI()) {
    try {
      const result = await runAI('perspective_extract', { topic, field }, { type: 'json_object' });
      if (tokenAcc) {
        tokenAcc.promptTokens += result.promptTokens || 0;
        tokenAcc.completionTokens += result.completionTokens || 0;
      }
      const parsed = JSON.parse(result.content);
      const views = Array.isArray(parsed.perspectives) ? parsed.perspectives.map(String).filter(Boolean) : [];
      if (views.length >= 2) return views.slice(0, 5);
    } catch (err) {
      logger.warn('paper-distillation', `多视角发现失败，回退默认视角: ${err.message}`);
    }
  }
  return DEFAULT_PERSPECTIVES;
}

// ===== Reduce 阶段：多框架融合 =====
// 合并多篇论文的框架，去重，按出现频率排序，生成最优结构
// 保留视角维度：perspectiveMap[视角] = { methods, innovations }，供大纲生成按视角组织
export function mergeFrameworks(frameworks) {
  // 用归一化 key 计数去重，但输出保留原始字符串（此前直接用 lower+截断的 key 作为输出，导致英文变小写、长文本被截断）
  const bump = (map, key, original) => {
    const cur = map.get(key);
    map.set(key, cur ? { original: cur.original, count: cur.count + 1 } : { original, count: 1 });
  };
  const normKey = (s) => s.toLowerCase().slice(0, 50);
  const topN = (map, n) => [...map.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, n).map(([, v]) => v.original);

  // 合并并去重方法
  const methodCount = new Map();
  const perspectiveMap = new Map();
  for (const f of frameworks) {
    const view = f.perspective || '综合';
    if (!perspectiveMap.has(view)) perspectiveMap.set(view, { methods: new Map(), innovations: new Map() });
    const pm = perspectiveMap.get(view);
    for (const m of f.methods) {
      const key = normKey(m);
      bump(methodCount, key, m);
      bump(pm.methods, key, m);
    }
    for (const i of f.innovations) {
      bump(pm.innovations, normKey(i), i);
    }
  }
  const methods = topN(methodCount, 5);

  // 合并创新点
  const innovCount = new Map();
  for (const f of frameworks) {
    for (const i of f.innovations) {
      bump(innovCount, normKey(i), i);
    }
  }
  const innovations = topN(innovCount, 3);

  // 合并结论
  const conclCount = new Map();
  for (const f of frameworks) {
    for (const c of f.conclusions) {
      bump(conclCount, normKey(c), c);
    }
  }
  const conclusions = topN(conclCount, 3);

  // 生成融合结构大纲（基于学术论文标准结构 + 借鉴的方法）
  const structure = generateMergedStructure(methods);

  // 视角分组（可序列化）
  const perspectives = [...perspectiveMap.entries()].map(([view, maps]) => ({
    view,
    methods: topN(maps.methods, 4),
    innovations: topN(maps.innovations, 3),
  }));

  return { methods, innovations, conclusions, structure, paperCount: frameworks.length, perspectives };
}

// 生成融合结构大纲
export function generateMergedStructure(methods) {
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
    // 注入后重排第三章小节编号，避免出现两个 3.3（此前 splice 后「关键模块设计」仍为 3.3）
    chapters[2].sections = chapters[2].sections.map((s, i) => s.replace(/^\d+\.\d+[\s.]*/, `3.${i + 1} `));
  }
  return chapters;
}

// ===== 大纲结构化：大纲文本 → 工作区结构化大纲 =====
// 兼容三种大纲格式（AI markdown / 内置模板中文序号 / 数字编号），
// 输出 [{chapter, sections:[{title}]}]，供工作区展示、确认与分章节生成消费。

// 清理章节名（去掉 markdown 标记与多余空格，保留完整名称）
function cleanName(s) {
  return String(s || '').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
}

export function outlineTextToStructure(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const chapters = [];
  let cur = null;

  for (const line of lines) {
    // 一级标题（论文题目）跳过；文末参考文献等附属标题跳过
    if (/^#\s/.test(line)) continue;
    if (/^(参考文献|致谢|附录|References|Acknowledg).*$/.test(line)) continue;

    // 1) markdown 二级标题：## 第一章 绪论
    let m = line.match(/^#{2}\s+(.+)$/);
    if (m) {
      cur = { chapter: cleanName(m[1]), sections: [] };
      chapters.push(cur);
      continue;
    }

    // 2) markdown 三级标题：### 1.1 小节
    m = line.match(/^#{3}\s+(.+)$/);
    if (m) {
      if (cur) cur.sections.push({ title: cleanName(m[1]) });
      continue;
    }

    // 3) 中文序号章节：一、引言 / 二、相关理论（仅当不以下级数字开头）
    m = line.match(/^[一二三四五六七八九十]+[、.．]\s*(.+)$/);
    if (m && !/^\d/.test(m[1])) {
      cur = { chapter: cleanName(line), sections: [] };
      chapters.push(cur);
      continue;
    }

    // 4) 「第X章」章节：第一章 绪论 / 第1章 绪论
    m = line.match(/^第[一二三四五六七八九十\d]+章[\s、.．]*(.*)$/);
    if (m) {
      cur = { chapter: cleanName(line), sections: [] };
      chapters.push(cur);
      continue;
    }

    // 5) 纯数字章节（无二级点号）：1 引言 / 1. 引言 / 1、引言
    m = line.match(/^([1-9]\d?)[、.．]\s*(.+)$/);
    if (m && !/^\d/.test(m[2])) {
      cur = { chapter: cleanName(line), sections: [] };
      chapters.push(cur);
      continue;
    }

    // 6) 小节：1.1 xxx / 1.1.1 xxx（保留编号）与 （1）xxx
    m = line.match(/^(\d+\.\d+(?:\.\d+)?)[.．、\s]*(.+)$/);
    if (m) {
      if (cur) cur.sections.push({ title: cleanName(`${m[1]} ${m[2]}`) });
      continue;
    }
    m = line.match(/^[（(]\d+[)）]\s*(.+)$/);
    if (m) {
      if (cur) cur.sections.push({ title: cleanName(line) });
      continue;
    }
  }

  // 过滤空章节；无任何小节时保留章节本身（用户可继续编辑）
  return chapters.filter((c) => c.chapter).map((c) => ({ chapter: c.chapter, sections: c.sections || [] }));
}

// 构建框架上下文（注入到AI生成的context中）
// papers 可选：仅用于统计来源数据库；持久化场景下可由 framework.paperCount / sources_used 提供
export function buildFrameworkContext(framework, papers = []) {
  const lines = [];
  const paperList = Array.isArray(papers) ? papers : [];
  const count = framework?.paperCount ?? paperList.length;
  const sources = framework?.sources_used?.length
    ? framework.sources_used
    : [...new Set(paperList.map((p) => p.source_db))];
  lines.push(`【文献调研结果】共参考 ${count} 篇相关论文（来自 ${sources.filter(Boolean).join('、') || '多源检索'}）`);
  lines.push('');
  // 视角分组（STORM 式多视角蒸馏产物）：按视角展示方法，便于大纲按维度组织
  const perspectives = Array.isArray(framework?.perspectives) ? framework.perspectives : [];
  if (perspectives.length > 0) {
    lines.push('【研究视角与方法分布】');
    for (const p of perspectives) {
      const viewMethods = (p.methods || []).slice(0, 3).join('；');
      lines.push(`- ${p.view}${viewMethods ? '：' + viewMethods : ''}`);
    }
    lines.push('');
  }
  lines.push('【主要研究方法】（按出现频率排序）');
  (framework?.methods || []).forEach((m, i) => lines.push(`${i + 1}. ${m}`));
  lines.push('');
  lines.push('【主要创新点】');
  (framework?.innovations || []).forEach((m, i) => lines.push(`${i + 1}. ${m}`));
  lines.push('');
  lines.push('【主要结论】');
  (framework?.conclusions || []).forEach((m, i) => lines.push(`${i + 1}. ${m}`));
  return lines.join('\n');
}

// ----------------------------------------------------------------------------
// 稳定性度量：同一输入跑 N 次，比较「结构 + 关键事实 + 表述」的一致性
// ----------------------------------------------------------------------------
// 为什么独立成脚本：
//   稳定性不是单条输出的属性，只看 (output, context) 无法判定，必须重复调用被测对象。
//   独立成模块后既能被 promptfoo 断言（assertStability）复用，也能在命令行单独跑：
//     node server/scripts/promptfoo-stability.mjs --tool literature_review --runs 5 \
//       --topic '深度学习在医学影像分割中的应用' --field 计算机科学
//
// 三个子分量的含义：
//   structureScore —— 章节标题序列是否逐次一致（跑题/漏章会在这里暴露）
//   factScore      —— 引文编号集合 + 数值指标集合是否逐次一致（事实漂移会在这里暴露）
//   contentScore   —— 正文二元词组集合的 Jaccard（衡量表述波动，真实模型天然低于模板引擎）
// ----------------------------------------------------------------------------
import { runGeneration } from './promptfoo-provider.mjs';
import {
  toText, tokenizeText, jaccardSimilarity, extractHeadings, normalizeHeading,
  extractCitationNumbers, extractNumericClaims, splitSections, DEFAULT_THRESHOLDS,
} from './promptfoo-assertions.mjs';

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// 从一次生成结果里抽取「结构指纹」与「事实指纹」
export function fingerprint(text) {
  const headings = extractHeadings(text).map((h) => normalizeHeading(h.text));
  const citations = [...new Set(extractCitationNumbers(text))].sort((a, b) => a - b);
  const numbers = extractNumericClaims(text).map((c) => `${c.kind}:${c.value}`).sort();
  const sectionTitles = splitSections(text).map((s) => normalizeHeading(s.title));
  return {
    structure: headings.length > 0 ? headings.join('>') : sectionTitles.join('>'),
    citations: citations.join(','),
    numbers: numbers.join(','),
    tokens: new Set(tokenizeText(text)),
  };
}

function compareFacts(a, b) {
  let score = 0;
  let weight = 0;
  const pairs = [
    [a.citations, b.citations],
    [a.numbers, b.numbers],
  ];
  for (const [x, y] of pairs) {
    weight += 1;
    if (!x && !y) score += 1;
    else if (!x || !y) score += 0;
    else {
      const setX = new Set(x.split(',').filter(Boolean));
      const setY = new Set(y.split(',').filter(Boolean));
      if (setX.size === 0 && setY.size === 0) score += 1;
      else score += jaccardSimilarity(setX, setY);
    }
  }
  return weight ? score / weight : 1;
}

// 核心度量：以 baseline（promptfoo 已产出的那一次）为参照，再跑 runs-1 次做比对
export async function measureStability(options = {}) {
  const {
    vars = {},
    runs = 3,
    baseline = '',
    config = {},
    generate = null,
  } = options;
  const totalRuns = Math.max(2, Math.min(8, num(runs, 3)));
  const threshold = num(config.threshold, DEFAULT_THRESHOLDS.stability);

  const produce = generate || (async (v) => (await runGeneration(v, { config })).output);
  const baseFp = fingerprint(toText(baseline));

  const structureHits = [];
  const factScores = [];
  const contentScores = [];
  const errors = [];

  for (let i = 1; i < totalRuns; i += 1) {
    try {
      const sample = await produce(vars);
      const fp = fingerprint(toText(sample));
      structureHits.push(fp.structure === baseFp.structure ? 1 : 0);
      factScores.push(compareFacts(baseFp, fp));
      contentScores.push(jaccardSimilarity(baseFp.tokens, fp.tokens));
    } catch (err) {
      errors.push(err.message);
      structureHits.push(0);
      factScores.push(0);
      contentScores.push(0);
    }
  }

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const structureScore = avg(structureHits);
  const factScore = avg(factScores);
  const contentScore = avg(contentScores);
  const score = 0.5 * structureScore + 0.3 * factScore + 0.2 * contentScore;
  const pass = errors.length === 0 && score >= threshold;

  const reason = errors.length > 0
    ? `稳定性度量执行失败：${errors.join('；')}`
    : `稳定性 ${score.toFixed(2)}（结构 ${structureScore.toFixed(2)} / 事实 ${factScore.toFixed(2)} / 表述 ${contentScore.toFixed(2)}，${totalRuns} 次采样，阈值 ${threshold}）`;

  return {
    pass, score, reason,
    details: { runs: totalRuns, structureScore, factScore, contentScore, errors },
  };
}

// 命令行入口：仅在直接执行该脚本时运行
const invokedDirectly = (() => {
  const entry = process.argv[1] || '';
  return entry.endsWith('promptfoo-stability.mjs');
})();

if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const read = (flag, fallback) => {
    const idx = argv.indexOf(flag);
    return idx >= 0 && argv[idx + 1] ? argv[idx + 1] : fallback;
  };
  const vars = {
    tool: read('--tool', 'literature_review'),
    topic: read('--topic', '深度学习在医学影像分割中的应用'),
    field: read('--field', '计算机科学'),
    keywords: read('--keywords', ''),
    years: read('--years', '近5年'),
  };
  const runs = num(read('--runs', '3'), 3);
  const first = await runGeneration(vars, { config: {} });
  const result = await measureStability({ vars, runs, baseline: first.output, config: {} });
  // 直接输出结论，便于人工回归与 CI 日志留存
  process.stdout.write(`${JSON.stringify({ tool: vars.tool, ...result }, null, 2)}\n`);
  process.exit(result.pass ? 0 : 1);
}

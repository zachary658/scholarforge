/**
 * 图表规划：
 *   - benchmark → vega-lite 图表配置（数据借鉴标注来源，由代码重绘而非复制原图）
 *   - [CHART:metric] 占位符替换为 vega 代码块
 *   - 实验/综述章节兜底：模型漏写占位符时自动补入真实指标图与提取表格
 * 从 paper-distillation.js 拆出。
 */
import { filterVerifiedWritingReferences } from './search.js';

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

// 实验/结果章节即使模型漏写占位符，也自动补入来自检索论文的真实指标图和提取表格。
// 只调整标题与展示结构，不改写任何原始数值。
export function ensureGroundedVisuals(content, { benchmarks = [], tables = [], references = [] } = {}, chapterName = '') {
  let output = String(content || '')
    // 内置演示引擎历史上会输出“示例数据，请替换”的回归表；这类数值没有证据，必须删除。
    .replace(/[^\n]*示例数据[^\n]*\n(?:\s*\n)?(?:\|[^\n]*\|\n)+(?:\s*\n)?[^\n]*示例数据[^\n]*\n?/g, '');
  if (!/实验|结果|分析|评估|对比|文献|综述|experiment|result|literature|review/i.test(chapterName)) return output;
  const existingVega = (output.match(/```vega\b/g) || []).length;
  const labels = [...new Set((benchmarks || []).flatMap((b) => (b.metrics || []).map((m) => m.label)))];
  for (const label of labels) {
    if ((output.match(/```vega\b/g) || []).length >= Math.max(2, existingVega)) break;
    const config = benchmarksToChartConfig(benchmarks, label);
    if (!config || (config.data?.values?.length || 0) < 2) continue;
    output += `\n\n### ${label}指标对比\n\n\`\`\`vega\n${JSON.stringify(config)}\n\`\`\`\n\n注：图中数值直接提取自所列真实论文，未由 AI 编造。`;
  }
  // OA 全文不可用时，不编造实验数值；改用检索记录自带的年份与引用次数生成可核查图表。
  const safeRefs = filterVerifiedWritingReferences(references);
  if (/文献|综述|literature|review/i.test(chapterName) && (output.match(/```vega\b/g) || []).length < 2 && safeRefs.length >= 3) {
    const years = new Map();
    for (const ref of safeRefs) {
      const year = String(ref.year || '').match(/(?:19|20)\d{2}/)?.[0];
      if (year) years.set(year, (years.get(year) || 0) + 1);
    }
    const metadataCharts = [];
    if (years.size >= 2) metadataCharts.push({
      title: '真实参考论文发表年份分布', mark: 'bar', data: { values: [...years].sort().map(([year, count]) => ({ year, count })) },
      encoding: { x: { field: 'year', type: 'ordinal', title: '发表年份' }, y: { field: 'count', type: 'quantitative', title: '论文数量' } },
    });
    const cited = safeRefs.filter((ref) => Number.isFinite(Number(ref.cited_by_count))).slice(0, 8);
    if (cited.length >= 2) metadataCharts.push({
      title: '真实参考论文引用次数对比', mark: 'bar', data: { values: cited.map((ref) => ({ paper: String(ref.title).slice(0, 20), citations: Number(ref.cited_by_count) || 0 })) },
      encoding: { x: { field: 'paper', type: 'nominal', title: '论文', axis: { labelAngle: -30 } }, y: { field: 'citations', type: 'quantitative', title: '引用次数' } },
    });
    for (const config of metadataCharts) {
      if ((output.match(/```vega\b/g) || []).length >= 2) break;
      output += `\n\n### ${config.title}\n\n\`\`\`vega\n${JSON.stringify(config)}\n\`\`\`\n\n注：图表仅使用学术数据库返回的真实元数据生成。`;
    }
  }
  const existingTables = (output.match(/^\|.+\|$/gm) || []).length;
  if (existingTables < 2) {
    for (const [index, table] of (tables || []).slice(0, 2).entries()) {
      const rows = (table.rows || []).filter((row) => Array.isArray(row) && row.length >= 2).slice(0, 10);
      if (rows.length < 2) continue;
      const width = Math.min(...rows.map((row) => row.length), 8);
      const normalized = rows.map((row) => row.slice(0, width).map((cell) => String(cell ?? '').replace(/\|/g, '/')));
      const header = normalized[0];
      output += `\n\n### 借鉴论文数据表 ${index + 1}\n\n| ${header.join(' | ')} |\n| ${header.map(() => '---').join(' | ')} |\n`;
      output += normalized.slice(1).map((row) => `| ${row.join(' | ')} |`).join('\n');
      output += `\n\n数据引自：${table.source || '已核验论文'}${table.year ? `（${table.year}）` : ''}${table.source_url ? `，${table.source_url}` : ''}。`;
    }
    if (/文献|综述|literature|review/i.test(chapterName) && (output.match(/^\|.+\|$/gm) || []).length < 2 && safeRefs.length >= 3) {
      output += '\n\n### 真实参考论文汇总\n\n| 论文题目 | 年份 | 来源 | DOI/回查入口 |\n| --- | --- | --- | --- |\n';
      output += safeRefs.slice(0, 8).map((ref) => {
        const locator = ref.doi ? `DOI: ${ref.doi}` : ref.source_url;
        return `| ${String(ref.title).replace(/\|/g, '/')} | ${ref.year || ''} | ${ref.source_db || ''} | ${locator || ''} |`;
      }).join('\n');
      output += '\n\n数据来源：OpenAlex、Semantic Scholar、Crossref 或 arXiv 检索记录。';
    }
  }
  return output;
}

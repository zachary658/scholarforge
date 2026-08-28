// 论文审校链服务（借鉴 GPT Researcher 的 reviewer→revisor 闭环）
// 流程：规则审校（确定性检查，零成本）→ AI 审校 → 发现问题则 AI 自动修订 → 规则复核 + 轻量 AI 复审
// 成本上限：AI 审校 1 次 + AI 修订 ≤1 次 + AI 复审结论 1 次（仅修订发生时），
// 任何环节失败均降级保留原稿，绝不因审校链阻断主流程。
import { runAI } from '../ai-service.js';
import logger from '../logger.js';

// —— 确定性规则审校（不调用 AI）——
// 返回 { errors: [{type, detail}], warnings: [{type, detail}] }
// errors：触发自动修订的硬问题；warnings：仅提示的软问题
export function ruleReview(content, references = []) {
  const errors = [];
  const warnings = [];
  if (!content) return { errors, warnings };

  // 正文 = 参考文献章节之前的部分（引用编号只统计正文，不统计文献列表自身）
  const refSplit = content.split(/(?:^|\n)#{1,4}\s*(?:参考文献|References)\s*(?:\n|$)/i);
  const hasRefSection = refSplit.length > 1;
  const body = hasRefSection ? refSplit.slice(0, -1).join('\n') : content;

  // 1) 引用一致性：正文 [n] 必须落在参考文献范围内（越界 = 无法对应的编造引用）
  const refCount = hasRefSection
    ? (refSplit[refSplit.length - 1].match(/^\s*\[\d+\]/gm) || []).length
    : (Array.isArray(references) ? references.length : 0);
  if (refCount > 0) {
    const cited = new Set();
    for (const m of body.matchAll(/\[(\d{1,3})\]/g)) cited.add(parseInt(m[1], 10));
    const outOfRange = [...cited].filter((n) => n > refCount).sort((a, b) => a - b);
    if (outOfRange.length > 0) {
      errors.push({
        type: 'citation',
        detail: `正文引用编号 [${outOfRange.join('][')}] 超出参考文献范围（共 ${refCount} 条），属于无法对应的引用`,
      });
    }
    // 未被正文引用的文献（软提示：文献列表较常见，不触发修订；过短的文献列表不提示防噪音）
    const uncited = [];
    for (let i = 1; i <= refCount; i++) if (!cited.has(i)) uncited.push(i);
    if (uncited.length > 0 && refCount > 2) {
      warnings.push({
        type: 'citation',
        detail: `参考文献 [${uncited.join('][')}] 未在正文中被引用`,
      });
    }
  }

  // 2) 占位符/待补内容残留（生成链未消化完的标记，交付前必须处理）
  const leftoverPatterns = [
    { re: /\[CITE:\d+\]/g, label: '引用占位符 [CITE:n]' },
    { re: /\[CHART:[^\]]*\]/g, label: '图表占位符 [CHART:...]' },
    { re: /【图表[^】]*】/g, label: '图表占位标记' },
    { re: /（数据待补充）/g, label: '“数据待补充”字样' },
  ];
  for (const p of leftoverPatterns) {
    const hits = (body.match(p.re) || []).length;
    if (hits > 0) {
      errors.push({ type: 'placeholder', detail: `发现 ${hits} 处${p.label}残留，需补充真实内容或删除` });
    }
  }

  // 3) 结构单薄（软提示）：二级标题过少
  const h2 = (content.match(/(^|\n)##\s+\S/g) || []).length;
  if (h2 > 0 && h2 < 3) {
    warnings.push({ type: 'structure', detail: `章节结构较单薄（仅 ${h2} 个二级标题）` });
  }

  return { errors, warnings };
}

// —— 解析 AI 审校报告结论：'pass' | 'revise' ——
// 报告约定格式含「## 审校结论（整体评价：通过 / 需修改）」；解析不出时宽容判 pass，
// 避免因格式问题误触发一次付费修订调用
export function parseReviewVerdict(reportText) {
  if (!reportText) return 'pass';
  // 结论段必须在下一个 ## 标题处截断：否则 120 字符窗口会溢出到「引用问题」等后续章节，
  // 其中常见的「需修改为 [3]」字样会把结论为「通过」的报告误判为 revise，多烧一次付费修订
  const m = reportText.match(/##\s*审校结论\s*\n([\s\S]*?)(?=\n#|$)/);
  const seg = (m ? m[1] : reportText.slice(0, 200)).slice(0, 200);
  // 优先匹配成对格式「整体评价：通过 / 需修改」
  const verdictLine = seg.match(/整体评价[：:]\s*(通过|需修改|需要修改|需修订|不通过)/);
  if (verdictLine) {
    return verdictLine[1] === '通过' ? 'pass' : 'revise';
  }
  if (/需修改|需要修改|需修订|不通过/.test(seg)) return 'revise';
  if (/通过/.test(seg)) return 'pass';
  return 'pass';
}

// 修订稿长度合理性：防止模型偷懒（只回摘要）或复读（输出翻倍），异常时保留原稿。
// 除总长度比例外，再守结构：二级标题大量丢失或参考文献章节消失，视为修订稿不完整（典型为截断）
function isSaneRevision(revised, original) {
  if (!revised) return false;
  const ratio = revised.length / Math.max(1, original.length);
  if (ratio < 0.6 || ratio > 1.6) return false;
  const h2Of = (t) => (t.match(/(^|\n)##\s+\S/g) || []).length;
  const origH2 = h2Of(original);
  if (origH2 >= 3 && h2Of(revised) < Math.ceil(origH2 * 0.5)) return false;
  if (/参考文献|references/i.test(original) && !/参考文献|references/i.test(revised)) return false;
  return true;
}

// —— 审校链主流程 ——
// logUsage：可选回调（tools 侧传入，用于把每次 AI 调用记入 usage_logs 核对成本）
// 返回 { content, revised, verdict, recheckVerdict, initialFindings, findings, report, reviseNote }
export async function runReviewChain({ content, references = [], userId = null, logUsage: log = null }) {
  const rule1 = ruleReview(content, references);
  let report = '';
  let verdict = 'pass';
  let aiAvailable = false;

  // 第一步：AI 审校（生成审校报告，供展示与修订依据）
  try {
    const ai1 = await runAI('review', { content });
    if (ai1.usedRealAI && ai1.content) {
      report = ai1.content;
      verdict = parseReviewVerdict(report);
      aiAvailable = true;
      log?.({
        userId,
        toolType: 'review',
        action: 'fulltext_review',
        model: ai1.model,
        inputChars: content.length,
        outputChars: ai1.content.length,
        tokens: ai1.tokens,
        status: 'success',
        chargeType: 'none',
        amount: 0,
      });
    }
  } catch (err) {
    logger.warn('review-chain', `AI 审校失败（仅规则审校）: ${err.message}`);
  }

  // 第二步：发现问题 → AI 自动修订（≤1 轮，控成本）
  const needsFix = verdict === 'revise' || rule1.errors.length > 0;
  let finalContent = content;
  let revised = false;
  let reviseNote = null;

  if (needsFix && aiAvailable) {
    try {
      const findings = rule1.errors.map((e) => `- ${e.detail}`).join('\n') || '（规则检查未发现硬伤，依据审校报告修订）';
      const rev = await runAI('revise', { content, review: report, findings });
      if (rev.usedRealAI && isSaneRevision(rev.content, content)) {
        finalContent = rev.content;
        revised = true;
        log?.({
          userId,
          toolType: 'revise',
          action: 'fulltext_revise',
          model: rev.model,
          inputChars: content.length + report.length,
          outputChars: rev.content.length,
          tokens: rev.tokens,
          status: 'success',
          chargeType: 'none',
          amount: 0,
        });
      } else if (rev.usedRealAI) {
        reviseNote = '修订稿长度异常，已保留原稿';
        logger.warn('review-chain', `修订稿长度比例异常（${rev.content?.length}/${content.length}），保留原稿`);
      }
    } catch (err) {
      logger.warn('review-chain', `AI 修订失败（保留原稿）: ${err.message}`);
    }
  }

  // 第三步：复核——修订后重跑规则审校；修订发生时再做一次轻量 AI 复审（只出结论）
  const rule2 = revised ? ruleReview(finalContent, references) : rule1;
  let recheckVerdict = null;
  if (revised && aiAvailable) {
    try {
      const ai2 = await runAI('review_verdict', { content: finalContent });
      if (ai2.usedRealAI && ai2.content) {
        recheckVerdict = /需修改|不通过/.test(ai2.content.split('\n')[0] || '') ? 'revise' : 'pass';
        log?.({
          userId,
          toolType: 'review',
          action: 'fulltext_recheck',
          model: ai2.model,
          inputChars: finalContent.length,
          outputChars: ai2.content.length,
          tokens: ai2.tokens,
          status: 'success',
          chargeType: 'none',
          amount: 0,
        });
      }
    } catch (err) {
      logger.warn('review-chain', `AI 复核失败（忽略）: ${err.message}`);
    }
  }

  logger.info('review-chain', `审校链完成：verdict=${verdict} revised=${revised} recheck=${recheckVerdict} errors=${rule2.errors.length}`);

  return {
    content: finalContent,
    revised,
    verdict,
    recheckVerdict,
    initialFindings: { errors: rule1.errors, warnings: rule1.warnings },
    findings: { errors: rule2.errors, warnings: rule2.warnings },
    report,
    reviseNote,
  };
}

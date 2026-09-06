// 文献检索与研究路由：智能写作（多源检索→蒸馏→原创生成）、文献综述生成。
// 挂载于 tools.js（/api/tools 前缀），共享 core 的计费执行与统一文档生成器。
import { Router } from 'express';
import { authRequired } from '../../middleware.js';
import logger from '../../logger.js';
import { getFeaturePrice, getSetting } from '../../config-store.js';
import { saveTask, saveProjectOutline, isProjectOwned, resolveAutoProject } from '../../services/task-store.js';
import { claimOrderExecution } from '../../services/order-claim.js';
import { transitionServiceToFailed, transitionServiceToCompleted } from '../../services/order-state.js';
import { assessResearchDelivery } from '../../services/research-quality.js';
import {
  runDocumentTool,
  loadTemplate,
  checkTextLen,
  resolveBilling,
  MAX_TOPIC_CHARS,
} from './core.js';

const router = Router();

// ========== 智能写作（检索→蒸馏→原创生成）==========
// 流程：多源检索同方向论文 → MapReduce提取框架 → 融合大纲 → 原创生成
// 现金直付：需关联已支付的 literature_review 订单
router.post('/smart-writing', authRequired, async (req, res) => {
  const { topic, field, keywords, projectId, orderNo } = req.body || {};
  if (!topic) return res.status(400).json({ error: '请填写论文题目' });
  if (!field) return res.status(400).json({ error: '请选择学科领域' });
  const lenErr = checkTextLen(topic, MAX_TOPIC_CHARS, '题目');
  if (lenErr) return res.status(400).json({ error: lenErr });

  // 安全：校验工作区归属（防跨用户上下文注入）
  if (projectId && !isProjectOwned(req.user.id, projectId)) {
    return res.status(403).json({ error: '无权访问该工作区' });
  }

  // 现金直付：智能写作需关联已支付订单
  const bill = resolveBilling(req.user.id, 'literature_review', orderNo);
  if (!bill.ok) return res.status(400).json({ error: bill.error });
  if (bill.mode === 'need_order') {
    const fp = getFeaturePrice('literature_review');
    return res.json({ needOrder: true, itemType: 'literature_review', amount: fp ? fp.price : 0 });
  }
  const order = bill.order || null;

  // 未指定工作区时先完成检索与质量校验；成功后再创建工作区，避免故障产生空项目。
  let autoProject = false;
  let projectReused = false;
  let effectiveProjectId = projectId;

  // 原子抢占：防同一订单并发重复执行（检索+蒸馏耗时数十秒）
  if (order && !claimOrderExecution(order)) {
    return res.status(400).json({ error: '订单正在处理中，请勿重复提交' });
  }

  try {
    const graphEnabled = ['1', 'true', 'yes'].includes(String(process.env.RESEARCH_GRAPH_ENABLED || '').toLowerCase());
    const result = graphEnabled
      ? await (await import('../../services/research-graph.js')).runResearchGraph({
          topic, field, keywords, projectId: effectiveProjectId, userId: req.user.id,
        })
      : await (await import('../../services/paper-distillation.js')).smartWriting({
          topic, field, keywords, projectId: effectiveProjectId, userId: req.user.id,
        });

    // DOI 与 CrossRef 元数据交叉核验；明确不存在或标题不匹配的 DOI 不参与交付计数。
    const { verifyReferenceDois } = await import('../../services/multi-source-search.js');
    const { filterVerifiedWritingReferences } = await import('../../services/paper-distillation.js');
    result.references = filterVerifiedWritingReferences(
      await verifyReferenceDois(result.references || [], { limit: (result.references || []).length })
    );
    // 大纲在核验前可能已把占位符变成编号。过滤记录后旧编号不再可靠，先清除，
    // 再仅用最终白名单重建文末文献表；正文阶段会基于该白名单重新生成准确引用。
    const { replaceCitePlaceholdersCsl } = await import('../../services/paper-distillation.js');
    result.outline = await replaceCitePlaceholdersCsl(
      String(result.outline || '').replace(/\[(\d+)\]/g, ''),
      result.references
    );

    // ===== 付费任务质量门禁 =====
    // 真实可溯源文献数量和框架完整度必须同时达到最低标准；不足时不能作为付费交付。
    // 门禁放在持久化之前：失败时不得向工作区写入空框架/模板大纲，避免污染用户工作区。
    const framework = result.framework || {};
    const quality = assessResearchDelivery(result);
    if (!quality.ok) {
      saveTask({
        userId: req.user.id,
        projectId: effectiveProjectId,
        toolType: 'smart-writing',
        action: 'search-distill',
        title: `智能写作框架提取：${topic}`,
        inputText: `题目：${topic} | 学科：${field} | 关键词：${keywords || ''}`,
        outputText: '',
        params: { topic, field, keywords, sources_used: framework.sources_used || [], search_errors: framework.search_errors || [] },
        contextSummary: `深度调研未通过质量门禁：${quality.reasons.join('；')}`,
        modelName: 'multi-source',
        tokens: 0,
        chargeType: order ? 'paid' : 'unlimited',
        amount: order ? order.amount : 0,
        orderId: order?.id || null,
        status: 'failed',
        errorCode: 'ai_unavailable',
      });
      if (order) {
        transitionServiceToFailed(order.id, { reason: `深度调研未通过质量门禁：${quality.reasons.join('；')}` });
      }
      return res.json({
        ok: false,
        failed: true,
        retriable: true,
        degraded: true,
        outline: result.outline || null,
        references: [],
        framework: result.framework || null,
        benchmarks: null,
        tables: [],
        projectId: effectiveProjectId,
        autoProject,
        projectReused,
        autoProjectTitle: autoProject ? String(topic).trim().slice(0, 100) : null,
        chargeType: order ? 'paid' : 'unlimited',
        amount: order ? order.amount : 0,
        orderNo: order?.order_no || null,
        message: `深度调研未达到交付标准（${quality.reasons.join('；')}）。本次生成未标记完成、可稍后重试（不额外扣费）；若多次失败请联系客服。`,
      });
    }

    if (!effectiveProjectId) {
      const resolved = resolveAutoProject(req.user.id, String(topic).trim().slice(0, 100));
      effectiveProjectId = resolved.id;
      projectReused = resolved.reused;
      autoProject = true;
    }

    // 蒸馏产物持久化到工作区：分章节生成/全文生成统一消费（框架/文献/数据/表格）
    try {
      const { saveProjectSources } = await import('../../services/task-store.js');
      saveProjectSources(effectiveProjectId, req.user.id, {
        framework: result.framework || null,
        references: result.references || [],
        benchmarks: Array.isArray(result.benchmarks?.data) ? result.benchmarks.data : [],
        tables: result.tables || [],
        sources_used: result.framework?.sources_used || [],
        saved_at: Math.floor(Date.now() / 1000),
      });
    } catch (err) {
      logger.warn('tools', `蒸馏产物持久化失败（忽略，本次仍可使用）: ${err.message}`);
    }

    // 深度调研大纲同步写入工作区结构化大纲：工作区可直接查看/确认/进入全文写作
    try {
      const { outlineTextToStructure } = await import('../../services/paper-distillation.js');
      const structure = outlineTextToStructure(result.outline);
      if (structure.length > 0) {
        saveProjectOutline(effectiveProjectId, req.user.id, structure);
      }
    } catch (err) {
      logger.warn('tools', `深度调研大纲结构化写入失败（忽略）: ${err.message}`);
    }

    const taskId = saveTask({
      userId: req.user.id,
      projectId: effectiveProjectId,
      toolType: 'smart-writing',
      action: 'search-distill',
      title: `智能写作框架提取：${topic}`,
      inputText: `题目：${topic} | 学科：${field} | 关键词：${keywords || ''}`,
      outputText: JSON.stringify(result.framework, null, 2).slice(0, 5000),
      params: { topic, field, keywords, sources_used: result.framework.sources_used },
      contextSummary: `参考 ${result.framework.paperCount} 篇论文，数据源：${result.framework.sources_used?.join('、')}`,
      modelName: 'multi-source',
      tokens: 0,
      chargeType: order ? 'paid' : 'unlimited',
      amount: order ? order.amount : 0,
      orderId: order?.id || null,
      status: 'success',
    });

    if (order) {
      transitionServiceToCompleted(order.id, { taskId });
    }

    res.json({
      ok: true,
      outline: result.outline,
      references: result.references,
      framework: result.framework,
      benchmarks: result.benchmarks,
      tables: result.tables || [],
      degraded: result.degraded,
      taskId,
      projectId: effectiveProjectId,
      autoProject,
      projectReused,
      autoProjectTitle: autoProject ? String(topic).trim().slice(0, 100) : null,
      retention_days: parseInt(getSetting('doc_retention_days', '30'), 10) || 30,
      chargeType: order ? 'paid' : 'unlimited',
      amount: order ? order.amount : 0,
      orderNo: order?.order_no || null,
      message: result.degraded
        ? `已检索 ${result.references.length} 篇相关论文（当前为模板降级模式，配置真实 AI 后框架提取与生成更精准）`
        : `已检索 ${result.references.length} 篇相关论文并提取研究框架，可基于此大纲生成分章节论文`,
    });
  } catch (err) {
    if (order) transitionServiceToFailed(order.id);
    res.status(err.statusCode || 500).json({ error: '智能写作失败：' + err.message });
  }
});

// ========== 文献综述生成（输出 Word） ==========
router.post('/literature-review', authRequired, async (req, res) => {
  const { topic, field, keywords, years, template_id } = req.body || {};
  if (!topic) return res.status(400).json({ error: '请填写研究主题' });
  const lenErr = checkTextLen(topic, MAX_TOPIC_CHARS, '主题');
  if (lenErr) return res.status(400).json({ error: lenErr });

  await runDocumentTool(req, res, {
    featureKey: 'literature_review',
    toolType: 'literature_review',
    action: 'literature_review',
    params: { topic, field, keywords, years },
    inputText: `【文献综述】主题：${topic}${field ? ' | 学科：' + field : ''}`,
    docTitle: `${topic}文献综述`,
    generateDocxOptions: { title: `${topic}文献综述`, template: loadTemplate(template_id, req.user.id) },
    errorPrefix: '文献综述生成',
  });
});

export default router;

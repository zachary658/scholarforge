// 论文写作与学术文档生成路由：全文/大纲、开题报告、任务书、答辩PPT、期刊论文、专利交底书、审稿意见回复。
// 挂载于 tools.js（/api/tools 前缀），共享 core 的计费执行与统一文档生成器。
import { Router } from 'express';
import { authRequired } from '../../middleware.js';
import db from '../../db.js';
import { logUsage } from '../../usage.js';
import logger from '../../logger.js';
import { getFeaturePrice } from '../../config-store.js';
import { generateDocx } from '../../services/docx-generator.js';
import { getProject, saveProjectSources, saveProjectOutline } from '../../services/task-store.js';
import { checkContent } from '../../services/content-safety.js';
import {
  executeWithBilling,
  runDocumentTool,
  loadTemplate,
  checkTextLen,
  hasAgreedAcademicIntegrity,
  MAX_INPUT_CHARS,
  MAX_TOPIC_CHARS,
} from './core.js';

const router = Router();

// ========== AI 论文写作（输出 Word） ==========
router.post('/writing', authRequired, async (req, res) => {
  const { type, topic, field, template_id, projectId, orderNo } = req.body || {};
  if (!type) return res.status(400).json({ error: '请选择写作类型' });
  if (!topic) return res.status(400).json({ error: '请填写论文题目' });
  // 学科必选：与 /smart-writing 一致；前端 Writing.jsx run() 已校验，后端兜底避免字段污染生成内容
  if (!field) return res.status(400).json({ error: '请选择学科领域' });
  const lenErr = checkTextLen(topic, MAX_TOPIC_CHARS, '题目');
  if (lenErr) return res.status(400).json({ error: lenErr });

  // 大纲强制确认：全文生成必须先有已确认的大纲（关联论文工作区）
  const writingProject = projectId ? getProject(projectId, req.user.id) : null;
  if (projectId && !writingProject) return res.status(404).json({ error: '工作区不存在' });
  if (writingProject?.workflow_mode === 'full') {
    if (type === 'fulltext') return res.status(400).json({ error: '请在完整论文流程中逐章生成并确认，不支持绕过确认一次生成全文' });
    if (type === 'outline' && (writingProject.workflow_state !== 'outline_review' || writingProject.chapters?.length)) return res.status(400).json({ error: '请在大纲确认阶段生成；已有正文时请保留原结构' });
  }
  if (type === 'fulltext') {
    if (!hasAgreedAcademicIntegrity(req.user.id)) {
      return res.status(403).json({ error: '请先阅读并同意《学术诚信承诺书》', needAcademicIntegrity: true });
    }
    if (!projectId) {
      return res.status(400).json({ error: '全文生成前请先创建论文工作区并确认大纲', needConfirmOutline: true });
    }
    const proj = db.prepare('SELECT id, outline_confirmed_at FROM projects WHERE id = ? AND user_id = ?').get(projectId, req.user.id);
    if (!proj) return res.status(404).json({ error: '工作区不存在' });
    if (!proj.outline_confirmed_at) {
      return res.status(400).json({ error: '请先在论文工作区确认大纲后再生成全文', needConfirmOutline: true });
    }
  }

  const featureKey = `writing_${type}`;
  const fp = getFeaturePrice(featureKey);
  if (!fp) return res.status(400).json({ error: '未知的写作类型' });

  // 加载模板
  let template = null;
  if (template_id) {
    template = db.prepare('SELECT * FROM templates WHERE id = ? AND (user_id = ? OR is_global = 1)').get(template_id, req.user.id);
  }

  // 全文/大纲：优先复用工作区已蒸馏的文献/数据（smart-writing 产物），否则实时检索
  // 检索失败降级，不阻断主流程
  let sourceRefs = null;
  let sourceBenchmarks = null;
  let sourceTables = null;
  if (type === 'fulltext' || type === 'outline') {
    if (projectId) {
      try {
        const proj = getProject(projectId, req.user.id);
        const src = proj?.sources || {};
        if (Array.isArray(src.references) && src.references.length > 0) sourceRefs = src.references;
        if (Array.isArray(src.benchmarks) && src.benchmarks.length > 0) sourceBenchmarks = src.benchmarks;
        if (Array.isArray(src.tables) && src.tables.length > 0) sourceTables = src.tables;
      } catch (err) {
        logger.warn('tools', `读取工作区蒸馏产物失败（忽略）: ${err.message}`);
      }
    }
    if (!sourceRefs) {
      try {
        const { collectWritingSources } = await import('../../services/paper-distillation.js');
        const { references, benchmarks } = await collectWritingSources(topic, field, '', 8);
        sourceRefs = references;
        sourceBenchmarks = benchmarks;
      } catch (err) {
        logger.warn('tools', `写作检索失败（忽略，改用无文献生成）: ${err.message}`);
      }
    }
    // 所有正文来源在进入模型前统一做 DOI 交叉核验，并只保留可回查的受控数据源记录。
    // 这也会清理历史工作区中可能残留的旧版/手工伪造来源。
    if (sourceRefs?.length) {
      const { verifyReferenceDois } = await import('../../services/multi-source-search.js');
      const { filterVerifiedWritingReferences } = await import('../../services/paper-distillation.js');
      sourceRefs = filterVerifiedWritingReferences(await verifyReferenceDois(sourceRefs, { limit: sourceRefs.length }));
    }
    if (type === 'fulltext' && (!sourceRefs || sourceRefs.length < 3)) {
      return res.status(503).json({
        error: '未检索到足量可核验的真实论文，本次未生成正文。请稍后重试或先完成深度文献调研。',
        code: 'INSUFFICIENT_VERIFIED_REFERENCES',
        retriable: true,
      });
    }
    // 大纲生成（免费快速版）：把检索到的真实文献/数据持久化到工作区，
    // 供后续章节/全文生成复用；已有深度蒸馏产物（framework 非空）时保留不覆盖
    if (type === 'outline' && projectId && sourceRefs?.length && writingProject?.workflow_mode !== 'full') {
      try {
        const existing = getProject(projectId, req.user.id)?.sources || {};
        if (!existing.framework) {
          saveProjectSources(projectId, req.user.id, {
            framework: existing.framework || null,
            references: sourceRefs,
            benchmarks: sourceBenchmarks || [],
            tables: existing.tables || [],
            sources_used: existing.sources_used || [],
            saved_at: Math.floor(Date.now() / 1000),
          });
        }
      } catch (err) {
        logger.warn('tools', `大纲来源持久化失败（忽略）: ${err.message}`);
      }
    }
  }

  try {
    const result = await executeWithBilling({
      userId: req.user.id,
      featureKey,
      toolType: 'writing',
      action: type,
      params: {
        type,
        topic,
        field,
        context: writingProject ? `学历：${writingProject.degree || '未指定'}\n写作要求：${writingProject.writing_requirements || '未指定'}\n${type === 'outline' ? '仅输出正文章节及小节；参考文献由系统统一生成，不要作为正文章节。按用户指定的研究类型组织结构；没有实际实验数据时不得默认安排已完成的实验结果或虚构实证结论。' : ''}` : '',
        ...(sourceRefs?.length ? { references: sourceRefs } : {}),
        ...(sourceBenchmarks?.length ? { benchmarks: sourceBenchmarks } : {}),
        ...(sourceTables?.length ? { dataTables: sourceTables } : {}),
      },
      projectId: projectId || null,
      inputText: `【${type}】题目：${topic}${field ? ' | 学科：' + field : ''}`,
      generateDocxOptions: {
        title: topic,
        template,
      },
      transformContent: async (content) => {
        const { replaceCitePlaceholders, replaceCitePlaceholdersCsl, replaceChartPlaceholders, ensureGroundedVisuals } = await import('../../services/paper-distillation.js');
        const cleaned = replaceCitePlaceholders(content, sourceRefs, { appendReferences: false });
        const grounded = ensureGroundedVisuals(replaceChartPlaceholders(cleaned, sourceBenchmarks), {
          benchmarks: sourceBenchmarks || [], tables: sourceTables || [], references: sourceRefs || [],
        }, type === 'fulltext' ? '实验与结果分析' : '');
        return replaceCitePlaceholdersCsl(grounded, sourceRefs);
      },
      orderNo: orderNo || null,
      materialIds: (req.body && req.body.material_ids) || null,
    });
    if (result.needOrder) {
      return res.json({ ...result });
    }

    // 全文生成后审校链（借鉴 GPT Researcher reviewer→revisor 闭环）：
    // 规则审校（免费确定性检查）→ AI 审校 → 发现问题自动修订 → 复核；
    // 修订发生则替换内容并重新生成 Word。仅真实 AI 下执行，各环节失败均降级保留原结果
    let review = null;
    let reviewChain = null;
    if (type === 'fulltext' && result.model?.usedRealAI && result.content) {
      try {
        const { runReviewChain } = await import('../../services/review-chain.js');
        const chain = await runReviewChain({
          content: result.content,
          references: sourceRefs || [],
          userId: req.user.id,
          logUsage,
        });
        review = chain.report || null;
        reviewChain = {
          revised: chain.revised,
          verdict: chain.verdict,
          recheckVerdict: chain.recheckVerdict,
          initialFindings: chain.initialFindings,
          findings: chain.findings,
          reviseNote: chain.reviseNote,
        };
        if (chain.revised && chain.content) {
          // 修订稿与首次输出执行同级内容安全审核，未通过则保留原稿
          const revisedCheck = await checkContent(chain.content);
          if (revisedCheck.safe) {
            result.content = chain.content;
            try {
              const newDoc = await generateDocx({
                title: topic,
                template,
                userId: req.user.id,
                feature: featureKey,
                orderId: result.orderId || null,
                projectId: result.projectId || null,
                content: chain.content,
              });
              if (newDoc) result.doc = newDoc;
            } catch (err) {
              logger.error('tools', `修订稿 docx 重新生成失败（保留原 Word）: ${err.message}`);
            }
          } else {
            logger.warn('tools', `修订稿内容安全未通过（${revisedCheck.reason}），保留原稿`);
            reviewChain.revised = false;
            reviewChain.recheckVerdict = null;
            reviewChain.reviseNote = '修订稿未通过内容安全审核，已保留原稿';
          }
        }
      } catch (err) {
        logger.warn('tools', `审校链失败（忽略）: ${err.message}`);
      }
    }

    // 大纲生成：解析为结构化大纲并写入工作区（此前只返回文本，工作区看不到大纲、无法进入全文写作）
    // 防静默覆盖：用户已确认（或已编辑）的大纲不被同题再次免费生成覆盖，避免编辑成果无声丢失
    if (type === 'outline' && result.projectId && result.content) {
      try {
        const proj = getProject(result.projectId, req.user.id);
        if (writingProject?.workflow_mode === 'full' && (!proj || proj.workflow_state !== 'outline_review'
          || proj.outline_version !== writingProject.outline_version
          || JSON.stringify(proj.outline) !== JSON.stringify(writingProject.outline)
          || JSON.stringify(proj.sources) !== JSON.stringify(writingProject.sources))) {
          throw new Error('生成期间大纲或资料已变更，已保留你最新保存的内容');
        }
        if (sourceRefs?.length && !proj?.sources?.framework && proj?.workflow_mode !== 'full') {
          saveProjectSources(result.projectId, req.user.id, {
            framework: proj?.sources?.framework || null,
            references: sourceRefs,
            benchmarks: sourceBenchmarks || [],
            tables: sourceTables || [],
            sources_used: proj?.sources?.sources_used || [],
            saved_at: Math.floor(Date.now() / 1000),
          });
        }
        if (proj && proj.outline_confirmed_at) {
          logger.warn('tools', `大纲已确认，跳过自动覆盖 project=${result.projectId}`);
        } else {
          const { outlineTextToStructure } = await import('../../services/paper-distillation.js');
          const structure = outlineTextToStructure(result.content).filter(ch => !/^(?:第[一二三四五六七八九十\d]+章\s*)?(?:参考文献|references|bibliography)$/i.test((ch.chapter || '').trim()));
          if (structure.length > 0) {
            saveProjectOutline(result.projectId, req.user.id, structure);
          } else if (writingProject?.workflow_mode === 'full') throw new Error('未解析出有效正文章节');
        }
      } catch (err) {
        if (writingProject?.workflow_mode === 'full') throw new Error(`大纲未能保存，请重试或手工填写：${err.message}`);
        logger.warn('tools', `大纲结构化写入失败（忽略，仅影响工作区大纲展示）: ${err.message}`);
      }
    }

    res.json({
      content: result.content,
      type,
      title: topic,
      model: result.model,
      tokens: result.tokens,
      doc: result.doc,
      review,
      reviewChain,
      chargeType: result.chargeType,
      amount: result.amount,
      orderId: result.orderId,
      taskId: result.taskId,
      projectId: result.projectId,
      autoProject: result.autoProject,
      autoProjectTitle: result.autoProjectTitle,
      retention_days: result.retention_days,
      orderNo: result.orderNo,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: '生成失败：' + err.message });
  }
});

// ========== 开题报告撰写（输出 Word） ==========
router.post('/proposal', authRequired, async (req, res) => {
  const { topic, field, direction, keywords, objective, method, innovation, template_id } = req.body || {};
  if (!topic) return res.status(400).json({ error: '请填写论文题目' });
  if (!field) return res.status(400).json({ error: '请选择学科领域' });
  const lenErr = checkTextLen(topic, MAX_TOPIC_CHARS, '题目') || checkTextLen(objective, MAX_INPUT_CHARS, '研究目标') || checkTextLen(method, MAX_INPUT_CHARS, '研究方法');
  if (lenErr) return res.status(400).json({ error: lenErr });

  await runDocumentTool(req, res, {
    featureKey: 'proposal',
    toolType: 'proposal',
    action: 'proposal',
    params: { topic, field, direction, keywords, objective, method, innovation },
    inputText: `【开题报告】题目：${topic} | 学科：${field}`,
    docTitle: `${topic}开题报告`,
    generateDocxOptions: { title: `${topic}开题报告`, template: loadTemplate(template_id, req.user.id) },
    errorPrefix: '开题报告生成',
  });
});

// ========== 任务书生成（输出 Word） ==========
router.post('/task-book', authRequired, async (req, res) => {
  const { topic, student_name, student_id, field, advisor, template_id } = req.body || {};
  if (!topic) return res.status(400).json({ error: '请填写论文题目' });
  const lenErr = checkTextLen(topic, MAX_TOPIC_CHARS, '题目');
  if (lenErr) return res.status(400).json({ error: lenErr });

  await runDocumentTool(req, res, {
    featureKey: 'task_book',
    toolType: 'task_book',
    action: 'task_book',
    params: { topic, student_name, student_id, field, advisor },
    inputText: `【任务书】题目：${topic}${student_name ? ' | 学生：' + student_name : ''}`,
    docTitle: `${topic}任务书`,
    generateDocxOptions: { title: `${topic}任务书`, template: loadTemplate(template_id, req.user.id) },
    errorPrefix: '任务书生成',
  });
});

// ========== 答辩PPT+演讲稿生成（输出 .pptx） ==========
router.post('/defense', authRequired, async (req, res) => {
  const { topic, field, research_content, innovation, duration } = req.body || {};
  if (!topic) return res.status(400).json({ error: '请填写论文题目' });
  const lenErr = checkTextLen(topic, MAX_TOPIC_CHARS, '题目') || checkTextLen(research_content, MAX_INPUT_CHARS, '研究内容');
  if (lenErr) return res.status(400).json({ error: lenErr });

  await runDocumentTool(req, res, {
    featureKey: 'defense',
    toolType: 'defense',
    action: 'defense',
    params: { topic, field, research_content, innovation, duration: duration || 10 },
    inputText: `【答辩】题目：${topic}${field ? ' | 学科：' + field : ''}`,
    docTitle: `${topic}答辩PPT`,
    generatePptxOptions: { title: `${topic}答辩PPT` },
    errorPrefix: '答辩材料生成',
  });
});

// ========== 期刊论文撰写（输出 Word） ==========
router.post('/journal', authRequired, async (req, res) => {
  const { topic, field, research_content, method, journal_type, template_id } = req.body || {};
  if (!topic) return res.status(400).json({ error: '请填写论文题目' });
  const lenErr = checkTextLen(topic, MAX_TOPIC_CHARS, '题目') || checkTextLen(research_content, MAX_INPUT_CHARS, '研究内容');
  if (lenErr) return res.status(400).json({ error: lenErr });

  await runDocumentTool(req, res, {
    featureKey: 'journal',
    toolType: 'journal',
    action: 'journal',
    params: { topic, field, research_content, method, journal_type },
    inputText: `【期刊论文】题目：${topic}${field ? ' | 学科：' + field : ''}`,
    docTitle: topic,
    generateDocxOptions: { title: topic, template: loadTemplate(template_id, req.user.id) },
    errorPrefix: '期刊论文生成',
  });
});

// ========== 专利申请辅助：专利技术交底书撰写（输出 Word） ==========
router.post('/patent-draft', authRequired, async (req, res) => {
  const { title, tech_description, template_id, projectId, orderNo } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: '请填写发明名称' });
  const lenErr = checkTextLen(title, MAX_TOPIC_CHARS, '发明名称') || checkTextLen(tech_description, MAX_INPUT_CHARS, '技术方案');
  if (lenErr) return res.status(400).json({ error: lenErr });

  let template = null;
  if (template_id) {
    template = db.prepare('SELECT * FROM templates WHERE id = ? AND (user_id = ? OR is_global = 1)').get(template_id, req.user.id);
  }

  try {
    const result = await executeWithBilling({
      userId: req.user.id,
      featureKey: 'patent_draft',
      toolType: 'patent_draft',
      action: 'patent_draft',
      params: { title: String(title).trim(), text: tech_description || '' },
      projectId: projectId || null,
      inputText: `【专利交底书】发明名称：${title}`,
      generateDocxOptions: { title: `${title}专利技术交底书`, template },
      orderNo: orderNo || null,
      materialIds: (req.body && req.body.material_ids) || null,
    });
    if (result.needOrder) {
      return res.json({ ...result });
    }
    res.json({
      content: result.content,
      title: `${title}专利技术交底书`,
      model: result.model,
      tokens: result.tokens,
      doc: result.doc,
      chargeType: result.chargeType,
      amount: result.amount,
      orderId: result.orderId,
      taskId: result.taskId,
      projectId: result.projectId,
      autoProject: result.autoProject,
      autoProjectTitle: result.autoProjectTitle,
      retention_days: result.retention_days,
      orderNo: result.orderNo,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: '专利交底书生成失败：' + err.message });
  }
});

// ========== 期刊发表辅助：审稿意见回复（输出 Word） ==========
router.post('/review-reply', authRequired, async (req, res) => {
  const { paper_title, field, review_comments, template_id, projectId, orderNo } = req.body || {};
  if (!paper_title || !String(paper_title).trim()) return res.status(400).json({ error: '请填写论文标题' });
  const lenErr = checkTextLen(paper_title, MAX_TOPIC_CHARS, '论文标题') || checkTextLen(review_comments, MAX_INPUT_CHARS, '审稿意见');
  if (lenErr) return res.status(400).json({ error: lenErr });

  let template = null;
  if (template_id) {
    template = db.prepare('SELECT * FROM templates WHERE id = ? AND (user_id = ? OR is_global = 1)').get(template_id, req.user.id);
  }

  try {
    const result = await executeWithBilling({
      userId: req.user.id,
      featureKey: 'review_reply',
      toolType: 'review_reply',
      action: 'review_reply',
      params: { title: String(paper_title).trim(), field: field || '', text: review_comments || '' },
      projectId: projectId || null,
      inputText: `【审稿意见回复】论文标题：${paper_title}`,
      generateDocxOptions: { title: `审稿意见回复信-${paper_title}`, template },
      orderNo: orderNo || null,
      materialIds: (req.body && req.body.material_ids) || null,
    });
    if (result.needOrder) {
      return res.json({ ...result });
    }
    res.json({
      content: result.content,
      title: `审稿意见回复信-${paper_title}`,
      model: result.model,
      tokens: result.tokens,
      doc: result.doc,
      chargeType: result.chargeType,
      amount: result.amount,
      orderId: result.orderId,
      taskId: result.taskId,
      projectId: result.projectId,
      autoProject: result.autoProject,
      autoProjectTitle: result.autoProjectTitle,
      retention_days: result.retention_days,
      orderNo: result.orderNo,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: '审稿意见回复生成失败：' + err.message });
  }
});

export default router;

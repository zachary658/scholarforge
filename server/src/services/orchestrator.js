// 多模型指挥中枢（有限编排版）
// 先按学科/任务选择角色，再由主写作模型产出、独立审校模型检查；只有审校发现问题时才触发一次修订。
// 所有模型都只能消费项目证据包，模型选择来自配置目录与实际可用 API Key。
import { getConfiguredModels, getDefaultModel, getSetting } from '../config-store.js';
import { runAI } from '../ai-service.js';

const FIELD_GROUPS = {
  technical: /计算机|软件|人工智能|数据|数学|物理|工程|机械|电子|信息|算法|医学影像/i,
  social: /管理|经济|金融|教育|心理|社会|法学|新闻|公共管理|语言|历史|文学|哲学/i,
};

function choose(models, keys, fallback) {
  return keys.map((k) => models.find((m) => m.key === k)).find(Boolean) || fallback || models[0] || null;
}

export function getRoleRouting() {
  try { return JSON.parse(getSetting('ai_role_routing', '{}')) || {}; } catch { return {}; }
}

export function buildModelPlan({ field = '', task = 'writing' } = {}) {
  const models = getConfiguredModels();
  const fallback = getDefaultModel() || models[0] || null;
  const group = FIELD_GROUPS.technical.test(field) ? 'technical' : FIELD_GROUPS.social.test(field) ? 'social' : 'general';
  const routing = getRoleRouting();
  const configured = routing[group] || routing.general || {};
  const primary = choose(models, [configured.writer], fallback);
  const reviewer = configured.reviewer === 'off' ? null : choose(models.filter(m => m.key !== primary?.key), [configured.reviewer], null);
  return {
    task, field, group,
    writer: primary ? { key: primary.key, name: primary.name } : null,
    reviewer: reviewer ? { key: reviewer.key, name: reviewer.name } : null,
    multiModel: Boolean(primary && reviewer && primary.key !== reviewer.key),
  };
}

export async function orchestrateChapter({ project, chapter, context, references = [], benchmarks = [], dataTables = [], evidenceIds = [] }) {
  const started = Date.now();
  const plan = buildModelPlan({ field: project.field, task: 'chapter' });
  if (!plan.writer && process.env.NODE_ENV === 'production') throw new Error('当前未配置可用写作模型，请联系客服；不会使用演示模板交付付费正文');
  const base = {
    type: 'paragraph', topic: project.title, field: project.field,
    references, benchmarks, dataTables, evidenceIds,
    context: `当前任务是完整章节而非短段落：${chapter.chapter}。按已确认小节充分展开；不要输出其他章、虚构实验或参考文献列表。引用仅使用 [CITE:n] 并对应所给文献；缺失数据明确标注待补充。\n\n${context}`,
  };
  const draft = await runAI('writing', base, null, plan.writer && plan.writer.key ? (getConfiguredModels().find((m) => m.key === plan.writer.key) || getDefaultModel()) : null);
  let content = draft.content || '';
  let review = null;
  let revisionTokens = 0;
  // 审校模型只输出问题报告，不得自行引入文献或数据；同一模型时跳过重复调用。
  if (plan.reviewer && draft.usedRealAI) {
    const reviewerModel = getConfiguredModels().find((m) => m.key === plan.reviewer.key) || getDefaultModel();
    review = await runAI('review', { content, references, benchmarks, dataTables, context: `论文题目：${project.title}\n章节：${chapter.chapter}\n${context}\n本次为单章审校，[CITE:n] 为合法引用标记，编号对应提供的文献；无需单章重复列出参考文献。` }, null, reviewerModel);
    // 审校模板本身总会包含「引用问题/数据问题」标题，只有明确结论为“需修改”才触发修订，避免每章无条件多花一次调用。
    if (review.content && /审校结论[\s\S]{0,160}需修改/.test(review.content)) {
      const revised = await runAI('revise', {
        content, review: review.content, references, benchmarks, dataTables, evidenceIds, context,
        findings: '仅修复审校指出的问题；不得新增未提供的文献、数据或实证结果。',
      }, null, plan.writer && getConfiguredModels().find((m) => m.key === plan.writer.key));
      if (revised.content) content = revised.content;
      revisionTokens = revised.tokens || 0;
    }
  }
  return {
    content,
    plan,
    agents: {
      writer: draft.model,
      reviewer: review?.model || null,
      review: review?.content || null,
    },
    tokens: (draft.tokens || 0) + (review?.tokens || 0) + revisionTokens,
    elapsedMs: Date.now() - started,
    usedRealAI: draft.usedRealAI,
  };
}

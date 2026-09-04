// 多模型指挥中枢（有限编排版）
// 先按学科/任务选择角色，再由主写作模型产出、独立审校模型检查；只有审校发现问题时才触发一次修订。
// 所有模型都只能消费项目证据包，模型选择来自配置目录与实际可用 API Key。
import { getConfiguredModels, getDefaultModel } from '../config-store.js';
import { runAI } from '../ai-service.js';

const FIELD_GROUPS = {
  technical: /计算机|软件|人工智能|数据|数学|物理|工程|机械|电子|信息|算法|医学影像/i,
  social: /管理|经济|金融|教育|心理|社会|法学|新闻|公共管理|语言|历史|文学|哲学/i,
};

function choose(models, keys, fallback) {
  return keys.map((k) => models.find((m) => m.key === k)).find(Boolean) || fallback || models[0] || null;
}

export function buildModelPlan({ field = '', task = 'writing' } = {}) {
  const models = getConfiguredModels();
  const fallback = getDefaultModel() || models[0] || null;
  const group = FIELD_GROUPS.technical.test(field) ? 'technical' : FIELD_GROUPS.social.test(field) ? 'social' : 'general';
  const primary = group === 'technical' ? choose(models, ['qwen', 'openai', 'deepseek'], fallback)
    : group === 'social' ? choose(models, ['deepseek', 'qwen', 'openai'], fallback)
      : choose(models, ['deepseek', 'qwen', 'openai'], fallback);
  const reviewer = choose(models, ['openai', 'qwen', 'deepseek'], primary);
  const planner = choose(models, ['qwen', 'deepseek', 'openai'], primary);
  return {
    task, field, group,
    planner: planner ? { key: planner.key, name: planner.name } : null,
    writer: primary ? { key: primary.key, name: primary.name } : null,
    reviewer: reviewer ? { key: reviewer.key, name: reviewer.name } : null,
    multiModel: Boolean(primary && reviewer && primary.key !== reviewer.key),
  };
}

export async function orchestrateChapter({ project, chapter, context, references = [], benchmarks = [], dataTables = [], evidenceIds = [] }) {
  const plan = buildModelPlan({ field: project.field, task: 'chapter' });
  const base = {
    type: 'paragraph', topic: project.title, field: project.field,
    references, benchmarks, dataTables, evidenceIds,
    context: `当前要撰写章节：${chapter.chapter}\n\n${context}`,
  };
  const draft = await runAI('writing', base, null, plan.writer && plan.writer.key ? (getConfiguredModels().find((m) => m.key === plan.writer.key) || getDefaultModel()) : null);
  let content = draft.content || '';
  let review = null;
  // 审校模型只输出问题报告，不得自行引入文献或数据；同一模型时跳过重复调用。
  if (plan.reviewer && draft.usedRealAI) {
    const reviewerModel = getConfiguredModels().find((m) => m.key === plan.reviewer.key) || getDefaultModel();
    review = await runAI('review', { content, references, context: `论文题目：${project.title}\n章节：${chapter.chapter}` }, null, reviewerModel);
    if (review.content && /需修改|引用问题|数据\/事实问题/.test(review.content)) {
      const revised = await runAI('revise', {
        content, review: review.content,
        findings: '仅修复审校指出的问题；不得新增未提供的文献、数据或实证结果。',
      }, null, plan.writer && getConfiguredModels().find((m) => m.key === plan.writer.key));
      if (revised.content) content = revised.content;
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
    tokens: (draft.tokens || 0) + (review?.tokens || 0),
  };
}

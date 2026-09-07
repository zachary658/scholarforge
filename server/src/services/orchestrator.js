// 多模型学术写作指挥中枢
// 任务分析 → 专家并行产出 → 主笔整合 → 独立双审 → 总编定稿。
// 模型只消费项目内已核验的证据包；任一辅助角色失败可降级，主笔失败会跨模型重试。
import { getConfiguredModels, getDefaultModel, getSetting } from '../config-store.js';
import { runAI } from '../ai-service.js';
import logger from '../logger.js';

export const ORCHESTRATION_ROLES = [
  'architect', 'evidence', 'methodologist', 'visual', 'writer', 'reviewer', 'verifier', 'synthesizer',
];

const FIELD_GROUPS = {
  technical: /计算机|软件|人工智能|数据|数学|物理|工程|机械|电子|信息|算法|医学影像|自动化|材料|化学|生物/i,
  social: /管理|经济|金融|教育|心理|社会|法学|新闻|公共管理|语言|历史|文学|哲学|艺术/i,
};

const ROLE_STRENGTHS = {
  architect: ['planning', 'reasoning', 'structured'],
  evidence: ['evidence', 'research', 'long_context', 'verification'],
  methodologist: ['methods', 'technical', 'reasoning', 'data'],
  visual: ['visual', 'data', 'technical', 'structured'],
  writer: ['writing', 'chinese', 'long_context', 'reasoning'],
  reviewer: ['review', 'reasoning', 'chinese'],
  verifier: ['verification', 'evidence', 'review', 'data'],
  synthesizer: ['synthesis', 'writing', 'long_context', 'reasoning'],
};

const ROLE_LABELS = {
  architect: '结构规划', evidence: '证据分析', methodologist: '方法设计', visual: '图表设计',
  writer: '章节主笔', reviewer: '逻辑审校', verifier: '事实与引用核验', synthesizer: '总编整合',
};

const ACADEMIC_TASK_LABELS = {
  proposal: '开题报告与研究方案',
  literature_review: '文献综述',
  task_book: '毕业论文任务书',
  journal: '期刊论文',
  defense: '答辩内容与演示结构',
};

export function shouldOrchestrateAcademicTask(tool) {
  return Object.hasOwn(ACADEMIC_TASK_LABELS, tool);
}

function fieldGroupOf(field) {
  return FIELD_GROUPS.technical.test(field) ? 'technical' : FIELD_GROUPS.social.test(field) ? 'social' : 'general';
}

export function analyzeAcademicMission({ field = '', chapter = {}, task = 'chapter' } = {}) {
  const title = `${chapter.chapter || chapter.title || ''} ${(chapter.sections || []).map((s) => s.title || s).join(' ')}`;
  const empirical = /实验|实证|结果|数据|调查|问卷|案例|性能|评估|分析/i.test(title);
  const methodological = empirical || /方法|模型|设计|算法|技术路线|研究方案|框架/i.test(title);
  const literature = /绪论|引言|背景|现状|综述|理论|概念|相关工作/i.test(title);
  const concluding = /讨论|结论|建议|展望|启示|对策/i.test(title);
  return {
    task,
    field,
    group: fieldGroupOf(field),
    chapter: chapter.chapter || chapter.title || '',
    profile: empirical ? 'empirical' : methodological ? 'methodological' : literature ? 'literature' : concluding ? 'synthesis' : 'general',
    needsEvidence: true,
    needsMethodologist: methodological,
    needsVisual: empirical || methodological,
    needsSynthesis: concluding || task === 'chapter',
  };
}

export function getRoleRouting() {
  try { return JSON.parse(getSetting('ai_role_routing', '{}')) || {}; } catch { return {}; }
}

function publicModel(model) {
  return model ? { key: model.key, name: model.name } : null;
}

function scoreModel(model, role, group, usedKeys) {
  const strengths = new Set(model.strengths || []);
  const wanted = ROLE_STRENGTHS[role] || [];
  let score = wanted.reduce((sum, strength, index) => sum + (strengths.has(strength) ? wanted.length - index : 0), 0);
  if (group === 'technical' && strengths.has('technical')) score += 4;
  if (group === 'social' && (strengths.has('social') || strengths.has('chinese'))) score += 4;
  if (usedKeys.has(model.key)) score -= 1.5;
  return score;
}

function chooseRoleModel(models, role, configuredKey, group, usedKeys, fallback) {
  if (configuredKey === 'off') return null;
  const configured = configuredKey ? models.find((model) => model.key === configuredKey) : null;
  if (configured) return configured;
  return [...models].sort((a, b) => scoreModel(b, role, group, usedKeys) - scoreModel(a, role, group, usedKeys))[0] || fallback || null;
}

export function buildModelPlan({ field = '', task = 'writing', chapter = {} } = {}) {
  const models = getConfiguredModels();
  const fallback = getDefaultModel() || models[0] || null;
  const mission = analyzeAcademicMission({ field, chapter, task });
  const routing = getRoleRouting();
  const configured = routing[mission.group] || routing.general || {};
  const assigned = {};
  const usedKeys = new Set();
  for (const role of ORCHESTRATION_ROLES) {
    const model = chooseRoleModel(models, role, configured[role], mission.group, usedKeys, fallback);
    assigned[role] = publicModel(model);
    if (model) usedKeys.add(model.key);
  }
  if (!mission.needsMethodologist) assigned.methodologist = null;
  if (!mission.needsVisual) assigned.visual = null;

  const activeKeys = new Set(Object.values(assigned).filter(Boolean).map((model) => model.key));
  return {
    task,
    field,
    group: mission.group,
    mission,
    roles: assigned,
    writer: assigned.writer,
    reviewer: assigned.reviewer,
    multiModel: activeKeys.size >= 2,
    mode: activeKeys.size >= 2 ? 'multi-model' : 'single-model-fallback',
    configuredModelCount: models.length,
  };
}

function modelForKey(key) {
  return getConfiguredModels().find((model) => model.key === key) || null;
}

// 供检索蒸馏、独立审校等既有多阶段流程复用同一套角色路由。
// 返回完整服务端模型配置（含仅存在于进程环境中的 Key），绝不经 API 返回。
export function getRoleModel({ field = '', task = 'writing', chapter = {}, role = 'writer' } = {}) {
  if (!ORCHESTRATION_ROLES.includes(role)) return null;
  const plan = buildModelPlan({ field, task, chapter });
  return modelForKey(plan.roles[role]?.key);
}

function safeSlice(value, max = 6000) {
  return String(value || '').slice(0, max);
}

function agentRecord(role, result, started, status = 'success', extra = {}) {
  return {
    role,
    label: ROLE_LABELS[role],
    status,
    model: result?.model || null,
    tokens: result?.tokens || 0,
    elapsedMs: Date.now() - started,
    ...extra,
  };
}

async function runRole(role, tool, params, plan, { required = false, exclude = [], runner = runAI } = {}) {
  const started = Date.now();
  if (!plan.roles[role]) {
    return { result: null, record: agentRecord(role, null, started, 'disabled') };
  }
  const configured = getConfiguredModels();
  const preferred = modelForKey(plan.roles[role]?.key);
  const candidates = [preferred, ...configured]
    .filter(Boolean)
    .filter((model, index, list) => !exclude.includes(model.key) && list.findIndex((item) => item.key === model.key) === index);
  const failures = [];
  for (const model of candidates) {
    try {
      const result = await runner(tool, params, null, model);
      if (!result.usedRealAI || !String(result.content || '').trim()) throw new Error('模型未返回有效内容');
      return { result, record: agentRecord(role, result, started, 'success', { selectedKey: model.key, failoverCount: failures.length }) };
    } catch (error) {
      failures.push({ key: model.key, message: error.message });
      logger.warn('orchestrator', `${ROLE_LABELS[role]}模型 ${model.key} 失败，尝试下一模型: ${error.message}`);
    }
  }
  const record = agentRecord(role, null, started, required ? 'failed' : 'degraded', {
    error: failures.at(-1)?.message || '未配置可用模型',
    attemptedModels: failures.map((item) => item.key),
  });
  if (required) {
    const error = new Error(`${ROLE_LABELS[role]}失败：${record.error}`);
    error.orchestrationRecord = record;
    throw error;
  }
  return { result: null, record };
}

function needsRevision(text) {
  const first = String(text || '').split('\n').slice(0, 3).join(' ');
  return /需修改|需要修改|不通过|REVISE/i.test(first);
}

function isSaneSynthesis(candidate, draft) {
  const next = String(candidate || '').trim();
  const original = String(draft || '').trim();
  if (!next || !original) return false;
  const ratio = next.length / original.length;
  if (ratio < 0.65 || ratio > 1.55) return false;
  const originalHeadings = (original.match(/(^|\n)#{2,3}\s+\S/g) || []).length;
  const nextHeadings = (next.match(/(^|\n)#{2,3}\s+\S/g) || []).length;
  return originalHeadings < 2 || nextHeadings >= Math.ceil(originalHeadings * 0.6);
}

function orchestrationContext({ mission, architecture, evidence, method, visual }) {
  return [
    `【指挥中枢任务画像】${JSON.stringify(mission)}`,
    architecture ? `【结构规划专家意见】\n${safeSlice(architecture)}` : '',
    evidence ? `【证据分析专家意见】\n${safeSlice(evidence)}` : '',
    method ? `【方法设计专家意见】\n${safeSlice(method)}` : '',
    visual ? `【图表设计专家意见】\n${safeSlice(visual)}` : '',
    '以上均为专家建议而非事实来源；正文事实、引用和数据仍只能取自后附的已核验证据包。',
  ].filter(Boolean).join('\n\n');
}

// 非完整论文流程中的长篇学术文档也接入同一中枢。一次产品操作仍只形成一次项目级收费，
// 内部专家调用作为该交付的一部分聚合计量，不向用户逐角色弹出付费窗口。
export async function orchestrateAcademicTask({ tool, params = {}, runner = runAI }) {
  if (!shouldOrchestrateAcademicTask(tool)) return runner(tool, params);
  const taskLabel = ACADEMIC_TASK_LABELS[tool];
  const chapter = {
    title: `${taskLabel} ${params.topic || params.title || ''} ${params.research_content || params.text || ''}`,
    sections: [],
  };
  const started = Date.now();
  const plan = buildModelPlan({ field: params.field || '', task: tool, chapter });
  plan.mission.needsSynthesis = true;
  if (!plan.multiModel) {
    const result = await runner(tool, params, null, modelForKey(plan.writer?.key) || getDefaultModel());
    return {
      ...result,
      orchestration: {
        plan,
        agents: [agentRecord('writer', result, started, result.usedRealAI ? 'success' : 'builtin')],
        elapsedMs: Date.now() - started,
      },
    };
  }

  const base = {
    ...params,
    topic: params.topic || params.title || taskLabel,
    chapter,
    context: params.context || params.text || params.research_content || '',
  };
  const [architectureRun, evidenceRun, methodRun, visualRun] = await Promise.all([
    runRole('architect', 'orchestrator_plan', base, plan, { runner }),
    runRole('evidence', 'orchestrator_evidence', base, plan, { runner }),
    plan.mission.needsMethodologist ? runRole('methodologist', 'orchestrator_method', base, plan, { runner }) : Promise.resolve(null),
    plan.mission.needsVisual ? runRole('visual', 'orchestrator_visual', base, plan, { runner }) : Promise.resolve(null),
  ]);
  const briefing = orchestrationContext({
    mission: plan.mission,
    architecture: architectureRun?.result?.content,
    evidence: evidenceRun?.result?.content,
    method: methodRun?.result?.content,
    visual: visualRun?.result?.content,
  });
  const writerRun = await runRole('writer', tool, {
    ...params,
    context: `${params.context || ''}\n\n${briefing}`.trim(),
  }, plan, { required: true, runner });
  const draft = writerRun.result.content;
  const [reviewRun, verifyRun] = await Promise.all([
    runRole('reviewer', 'orchestrator_review', { ...base, content: draft }, plan, { exclude: [writerRun.record.selectedKey], runner }),
    runRole('verifier', 'orchestrator_verify', { ...base, content: draft }, plan, { exclude: [writerRun.record.selectedKey], runner }),
  ]);
  let synthesisRun = null;
  let content = draft;
  if (reviewRun?.result || verifyRun?.result) {
    synthesisRun = await runRole('synthesizer', 'orchestrator_synthesize', {
      ...base,
      content: draft,
      review: safeSlice(reviewRun?.result?.content, 5000),
      verification: safeSlice(verifyRun?.result?.content, 5000),
      findings: `${needsRevision(reviewRun?.result?.content) ? '逻辑审校要求修改。' : ''}${needsRevision(verifyRun?.result?.content) ? '事实核验要求修改。' : ''}`,
    }, plan, { exclude: [reviewRun?.record?.selectedKey, verifyRun?.record?.selectedKey].filter(Boolean), runner });
    if (isSaneSynthesis(synthesisRun.result?.content, draft)) content = synthesisRun.result.content;
    else if (synthesisRun.result) synthesisRun.record = { ...synthesisRun.record, status: 'rejected', error: '总编稿长度或结构异常，已保留主笔稿' };
  }
  const runs = [architectureRun, evidenceRun, methodRun, visualRun, writerRun, reviewRun, verifyRun, synthesisRun].filter(Boolean);
  return {
    content,
    model: { key: 'orchestrator', name: '多模型指挥中枢' },
    tokens: runs.reduce((sum, run) => sum + (run.result?.tokens || 0), 0),
    promptTokens: runs.reduce((sum, run) => sum + (run.result?.promptTokens || 0), 0),
    completionTokens: runs.reduce((sum, run) => sum + (run.result?.completionTokens || 0), 0),
    usedRealAI: true,
    orchestration: { plan, agents: runs.map((run) => run.record), elapsedMs: Date.now() - started },
  };
}

export async function orchestrateChapter({ project, chapter, context, references = [], benchmarks = [], dataTables = [], evidenceIds = [], runner = runAI }) {
  const started = Date.now();
  const plan = buildModelPlan({ field: project.field, task: 'chapter', chapter });
  if (!plan.writer && process.env.NODE_ENV === 'production') throw new Error('当前未配置可用写作模型，请联系客服；不会使用演示模板交付付费正文');

  if (!plan.multiModel) {
    const writerModel = modelForKey(plan.writer?.key) || getDefaultModel();
    const draft = await runner('writing', {
      type: 'paragraph', topic: project.title, field: project.field, references, benchmarks, dataTables, evidenceIds,
      context: `当前任务是完整章节而非短段落：${chapter.chapter}。按已确认小节充分展开；不要输出其他章、虚构实验或参考文献列表。引用仅使用 [CITE:n] 并对应所给文献；缺失数据明确标注待补充。\n\n${context}`,
    }, null, writerModel);
    return {
      content: draft.content || '',
      plan,
      agents: [agentRecord('writer', draft, started, draft.usedRealAI ? 'success' : 'builtin')],
      tokens: draft.tokens || 0,
      elapsedMs: Date.now() - started,
      usedRealAI: draft.usedRealAI,
    };
  }

  const base = { topic: project.title, field: project.field, chapter, context, references, benchmarks, dataTables, evidenceIds };
  const [architectureRun, evidenceRun, methodRun, visualRun] = await Promise.all([
    runRole('architect', 'orchestrator_plan', base, plan, { runner }),
    runRole('evidence', 'orchestrator_evidence', base, plan, { runner }),
    plan.mission.needsMethodologist ? runRole('methodologist', 'orchestrator_method', base, plan, { runner }) : Promise.resolve(null),
    plan.mission.needsVisual ? runRole('visual', 'orchestrator_visual', base, plan, { runner }) : Promise.resolve(null),
  ]);
  const briefing = orchestrationContext({
    mission: plan.mission,
    architecture: architectureRun?.result?.content,
    evidence: evidenceRun?.result?.content,
    method: methodRun?.result?.content,
    visual: visualRun?.result?.content,
  });

  const writerRun = await runRole('writer', 'writing', {
    type: 'paragraph', topic: project.title, field: project.field, references, benchmarks, dataTables, evidenceIds,
    context: `当前任务是完整章节而非短段落：${chapter.chapter}。按已确认小节充分展开；不要输出其他章、虚构实验或参考文献列表。引用仅使用 [CITE:n] 并对应所给文献。\n\n${briefing}\n\n${context}`,
  }, plan, { required: true, runner });
  const draft = writerRun.result.content;

  const [reviewRun, verifyRun] = await Promise.all([
    runRole('reviewer', 'orchestrator_review', { ...base, content: draft }, plan, { exclude: [writerRun.record.selectedKey], runner }),
    runRole('verifier', 'orchestrator_verify', { ...base, content: draft }, plan, { exclude: [writerRun.record.selectedKey], runner }),
  ]);

  let content = draft;
  let synthesisRun = null;
  if (plan.mission.needsSynthesis && (reviewRun?.result || verifyRun?.result)) {
    synthesisRun = await runRole('synthesizer', 'orchestrator_synthesize', {
      ...base,
      content: draft,
      review: safeSlice(reviewRun?.result?.content, 5000),
      verification: safeSlice(verifyRun?.result?.content, 5000),
      findings: `${needsRevision(reviewRun?.result?.content) ? '逻辑审校要求修改。' : ''}${needsRevision(verifyRun?.result?.content) ? '事实核验要求修改。' : ''}`,
    }, plan, { exclude: [reviewRun?.record?.selectedKey, verifyRun?.record?.selectedKey].filter(Boolean), runner });
    if (isSaneSynthesis(synthesisRun.result?.content, draft)) content = synthesisRun.result.content;
    else if (synthesisRun.result) synthesisRun.record = { ...synthesisRun.record, status: 'rejected', error: '总编稿长度或结构异常，已保留主笔稿' };
  }

  const runs = [architectureRun, evidenceRun, methodRun, visualRun, writerRun, reviewRun, verifyRun, synthesisRun].filter(Boolean);
  return {
    content,
    plan,
    agents: runs.map((run) => run.record),
    reviews: { logic: reviewRun?.result?.content || '', verification: verifyRun?.result?.content || '' },
    tokens: runs.reduce((sum, run) => sum + (run.result?.tokens || 0), 0),
    elapsedMs: Date.now() - started,
    usedRealAI: true,
  };
}

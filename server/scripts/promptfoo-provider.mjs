// ----------------------------------------------------------------------------
// Promptfoo 自定义 Provider（ScholarForge 生成入口适配层）
// ----------------------------------------------------------------------------
// 作用：把 promptfoo 的一条测试用例（vars + 渲染后的 prompt）翻译成 ScholarForge
// 内部的一次生成调用 runAI(tool, params)，从而在同一套评测框架里横向对比
// 「prompt A / prompt B / 内置模板引擎基线」以及未来接入的不同模型。
//
// 契约（已核实官方文档 https://www.promptfoo.dev/docs/providers/custom-api/）：
//   1. ESM provider 文件必须以 .mjs 结尾，默认导出实现 id() 与 callApi() 的类或对象；
//   2. callApi(prompt, context, options) 返回 ProviderResponse：
//      { output, error?, metadata?, tokenUsage? }，output 为字符串时断言可直接用；
//   3. 测试变量从 context.vars 读取，provider 级配置从构造函数 options.config 读取；
//   4. 配置里的 file:// 路径相对 promptfooconfig.yaml 所在目录（仓库根）解析。
//
// 两种运行模式：
//   - live  ：真正调用 runAI（配置了真实 AI Key 时走真实模型，否则自动回退内置模板引擎，
//             因此离线 CI 里也能跑出确定性结果）；
//   - mock  ：不调用 runAI，直接返回 server/eval/fixtures/*.json 中预置的输出。
//             用于在完全确定的语料上验证「断言逻辑本身」是否正确（断言不是摆设）。
// ----------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAI } from '../src/ai-service.js';
import logger from '../src/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, '..', 'eval', 'fixtures');

// 缺省 fixture：SF_PROMPTFOO_MOCK=1 但未指定 fixture 时使用
const DEFAULT_FIXTURE = 'good-literature-review';

// 允许在评测中使用的生成工具（避免误传未知 tool 让 runAI 返回空串）
const ALLOWED_TOOLS = new Set([
  'writing', 'polish', 'translate', 'grammar', 'rewrite', 'proposal',
  'defense', 'literature_review', 'task_book', 'journal', 'patent_draft', 'review_reply',
]);

// vars 中约定以 JSON 字符串传入的结构化字段（断言需要按对象使用）
const JSON_VAR_KEYS = ['references', 'benchmarks', 'dataTables', 'materials', 'outline', 'keywords'];

// 控制变量：不属于业务参数，不能透传给 runAI
const CONTROL_VAR_KEYS = new Set(['tool', 'fixture', 'mode', 'runs', 'min_length', 'min_references', 'terms', 'expectation']);

function isTruthyEnv(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

// 解析 vars 里的 JSON 字符串字段；非 JSON 时原样返回（由调用方兜底）
export function parseVarValue(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// 模式优先级：用例显式 mode > 用例带了 fixture > 环境变量 SF_PROMPTFOO_MOCK > 默认 live
export function resolveMode(vars = {}, config = {}, env = process.env) {
  if (vars.mode === 'live' || vars.mode === 'mock') return vars.mode;
  if (vars.fixture) return 'mock';
  if (isTruthyEnv(env.SF_PROMPTFOO_MOCK) || config.mock === true) return 'mock';
  return 'live';
}

// 读取预置语料。fixture 文件格式：{ id, description, tool, lines: string[] } 或 { output: string }
export function loadFixture(name) {
  const safe = String(name || '').replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safe) throw new Error('fixture 名称非法');
  const file = path.join(FIXTURE_DIR, `${safe}.json`);
  if (!fs.existsSync(file)) throw new Error(`fixture 不存在：${file}`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const output = typeof data.output === 'string' ? data.output : (data.lines || []).join('\n');
  return { id: data.id || safe, description: data.description || '', tool: data.tool || '', output };
}

// 由 vars 构造 runAI 的参数对象
export function buildRunParams(vars = {}) {
  const params = {};
  for (const [k, v] of Object.entries(vars)) {
    if (CONTROL_VAR_KEYS.has(k)) continue;
    params[k] = JSON_VAR_KEYS.includes(k) ? parseVarValue(v, v) : v;
  }
  return params;
}

// 把渲染后的 promptfoo prompt 作为「附加写作指令」注入生成上下文。
// 这样 prompt A / prompt B 的差异才会真正作用到生成结果上，形成可对比的评测矩阵。
function applyPromptVariant(params, prompt, config = {}) {
  if (config.ignorePrompt === true || config.variant === 'baseline') return params;
  const text = String(prompt || '').trim();
  if (!text) return params;
  const merged = params.context ? `${text}\n\n${params.context}` : text;
  return { ...params, context: merged };
}

// 单次生成：provider 与稳定性断言共用同一入口，保证「稳定性用例跑的就是被测对象」
export async function runGeneration(vars = {}, options = {}) {
  const { prompt = '', config = {}, env = process.env } = options;
  const tool = String(vars.tool || 'literature_review');
  const mode = resolveMode(vars, config, env);

  if (!ALLOWED_TOOLS.has(tool)) {
    return { output: '', metadata: { usedRealAI: false, tool, mode, error: `不支持的 tool：${tool}` }, error: `不支持的 tool：${tool}` };
  }

  if (mode === 'mock') {
    const name = String(vars.fixture || config.defaultFixture || DEFAULT_FIXTURE);
    try {
      const fx = loadFixture(name);
      return {
        output: fx.output,
        metadata: { usedRealAI: false, tool: fx.tool || tool, mode: 'mock', fixture: fx.id, latencyMs: 0 },
      };
    } catch (err) {
      logger.warn('promptfoo-provider', `fixture 加载失败，回退空输出：${err.message}`);
      return { output: '', metadata: { usedRealAI: false, tool, mode: 'mock', error: err.message }, error: err.message };
    }
  }

  const started = Date.now();
  try {
    const params = applyPromptVariant(buildRunParams(vars), prompt, config);
    const result = await runAI(tool, params);
    // 基线模式要求走内置模板引擎；若环境已配置真实模型则如实告警，
    // 避免「基线」与「实验组」实际同源却无人知晓，导致对比结论失真。
    if (config.forceBuiltin === true && result.usedRealAI) {
      logger.warn('promptfoo-provider', '基线 provider 请求 forceBuiltin，但当前环境已配置真实模型，基线实际走了真实 AI');
    }
    return {
      output: result.content || '',
      metadata: {
        usedRealAI: !!result.usedRealAI,
        tool,
        mode: 'live',
        variant: config.variant || 'default',
        latencyMs: Date.now() - started,
      },
    };
  } catch (err) {
    logger.warn('promptfoo-provider', `runAI 执行失败：${err.message}`);
    return {
      output: '',
      error: err.message,
      metadata: { usedRealAI: false, tool, mode: 'live', latencyMs: Date.now() - started, error: err.message },
    };
  }
}

export default class ScholarForgeProvider {
  constructor(options = {}) {
    // promptfoo 会把 YAML 里 providers[].id 作为 options.id 传入，label 用于报告展示
    this.providerId = options.id || 'scholarforge';
    this.config = options.config || {};
  }

  id() {
    return this.providerId;
  }

  async callApi(prompt, context = {}, options = {}) {
    const vars = { ...(this.config.vars || {}), ...(context.vars || {}) };
    const result = await runGeneration(vars, { prompt, config: this.config, options });
    if (result.error) return { output: result.output || '', error: result.error, metadata: result.metadata };
    return { output: result.output, metadata: result.metadata };
  }
}

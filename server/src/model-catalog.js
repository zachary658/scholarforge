// 内置 AI 模型预设目录（OpenAI 兼容协议）
//
// 安全设计：API Key 一律通过环境变量注入（LLM_API_KEY_<KEY 大写>），
// 不存储在数据库、不返回给前端，从根本上避免 Key 因拖库/配置失误泄露。
//
// 新增模型只需两步：
//   1. 在本文件追加一条预设记录（key 需唯一）
//   2. 在部署环境配置对应环境变量 LLM_API_KEY_XXX
// 无需改动其他代码，管理后台会自动展示并支持「设为默认 / 测试连接」。

export const MODEL_CATALOG = [
  {
    key: 'deepseek',
    name: 'DeepSeek',
    provider: 'deepseek',
    base_url: 'https://api.deepseek.com/v1',
    model_name: 'deepseek-chat',
    env_key: 'LLM_API_KEY_DEEPSEEK',
    temperature: 0.7,
    max_tokens: 8192,
  },
  {
    key: 'qwen',
    name: '通义千问',
    provider: 'qwen',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model_name: 'qwen-plus',
    env_key: 'LLM_API_KEY_QWEN',
    temperature: 0.7,
    max_tokens: 8192,
  },
  {
    key: 'zhipu',
    name: '智谱 GLM',
    provider: 'zhipu',
    base_url: 'https://open.bigmodel.cn/api/paas/v4',
    model_name: 'glm-4-plus',
    env_key: 'LLM_API_KEY_ZHIPU',
    temperature: 0.7,
    max_tokens: 8192,
  },
  {
    key: 'kimi',
    name: 'Kimi（月之暗面）',
    provider: 'moonshot',
    base_url: 'https://api.moonshot.cn/v1',
    model_name: 'moonshot-v1-8k',
    env_key: 'LLM_API_KEY_KIMI',
    temperature: 0.7,
    max_tokens: 8192,
  },
  {
    key: 'openai',
    name: 'OpenAI',
    provider: 'openai',
    base_url: 'https://api.openai.com/v1',
    model_name: 'gpt-4o-mini',
    env_key: 'LLM_API_KEY_OPENAI',
    temperature: 0.7,
    max_tokens: 8192,
  },
];

// 按 key 查找预设
export function getModelPreset(key) {
  return MODEL_CATALOG.find((m) => m.key === key) || null;
}

// 读取预设对应的环境变量 Key（未配置返回空串）
export function getModelKeyFromEnv(preset) {
  if (!preset || !preset.env_key) return '';
  return (process.env[preset.env_key] || '').trim();
}

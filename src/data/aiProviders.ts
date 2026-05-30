/**
 * AI provider presets — shared by Onboarding and SettingsModal.
 *
 * Each preset fills the AI base URL + suggested chat / embedding model
 * + a link to where the user creates the API key. The list is OpenAI-compatible
 * only; non-compatible providers (e.g. Anthropic native API) should be reached
 * through an aggregator like OpenRouter.
 */

export interface AiProvider {
  /** Stable id used to remember the user's choice. */
  id: string;
  /** Display name. */
  label: string;
  /** Short tagline shown under the label. */
  tagline: string;
  /** OpenAI-compatible base URL (ending in `/v1`). */
  url: string;
  /** Recommended chat / completion model. */
  chatModel: string;
  /** Recommended embedding model (used by the semantic search indexer). */
  embedModel: string;
  /** Placeholder shown in the API-key input. */
  keyHint: string;
  /** Where to register / find the API key. Empty = no link shown. */
  docsUrl: string;
  /** True for providers that run entirely on the local machine (e.g. Ollama). No API key required. */
  local?: boolean;
}

export const AI_PROVIDERS: AiProvider[] = [
  {
    id: "dashscope",
    label: "DashScope (Aliyun)",
    tagline: "通义千问，国内访问稳定，新用户有免费额度",
    url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    chatModel: "qwen-turbo",
    embedModel: "text-embedding-v3",
    keyHint: "sk-… (DashScope API Key)",
    docsUrl: "https://dashscope.console.aliyun.com/apiKey",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    tagline: "性价比极高，代码能力强",
    url: "https://api.deepseek.com/v1",
    chatModel: "deepseek-chat",
    embedModel: "",
    keyHint: "sk-… (DeepSeek API Key)",
    docsUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "moonshot",
    label: "Moonshot (Kimi)",
    tagline: "长上下文友好，128k tokens",
    url: "https://api.moonshot.cn/v1",
    chatModel: "moonshot-v1-8k",
    embedModel: "",
    keyHint: "sk-… (Moonshot API Key)",
    docsUrl: "https://platform.moonshot.cn/console/api-keys",
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    tagline: "聚合开源模型 (Qwen / Llama / DeepSeek …)",
    url: "https://api.siliconflow.cn/v1",
    chatModel: "Qwen/Qwen2.5-7B-Instruct",
    embedModel: "BAAI/bge-m3",
    keyHint: "sk-… (SiliconFlow API Key)",
    docsUrl: "https://cloud.siliconflow.cn/account/ak",
  },
  {
    id: "openai",
    label: "OpenAI",
    tagline: "GPT-4o / o-mini，国外节点",
    url: "https://api.openai.com/v1",
    chatModel: "gpt-4o-mini",
    embedModel: "text-embedding-3-small",
    keyHint: "sk-… (OpenAI API Key)",
    docsUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "groq",
    label: "Groq",
    tagline: "推理超快 (Llama / Mixtral)，有免费额度",
    url: "https://api.groq.com/openai/v1",
    chatModel: "llama-3.1-70b-versatile",
    embedModel: "",
    keyHint: "gsk_… (Groq API Key)",
    docsUrl: "https://console.groq.com/keys",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    tagline: "一个 Key 调用 100+ 模型 (含 Claude / Gemini)",
    url: "https://openrouter.ai/api/v1",
    chatModel: "anthropic/claude-3.5-sonnet",
    embedModel: "",
    keyHint: "sk-or-… (OpenRouter API Key)",
    docsUrl: "https://openrouter.ai/keys",
  },
  {
    id: "ollama",
    label: "Ollama (本地)",
    tagline: "本地运行，离线可用，无 API 费用",
    url: "http://localhost:11434/v1",
    chatModel: "llama3.2",
    embedModel: "nomic-embed-text",
    keyHint: "ollama (or leave empty)",
    docsUrl: "https://ollama.com",
    local: true,
  },
  {
    id: "custom",
    label: "Custom / Other",
    tagline: "手动填入 OpenAI 兼容的任意端点",
    url: "",
    chatModel: "",
    embedModel: "",
    keyHint: "API key",
    docsUrl: "",
  },
];

/** Find the preset best matching a given base URL. Returns "custom" when no match. */
export function detectProvider(url: string): AiProvider {
  const u = url.trim().toLowerCase();
  for (const p of AI_PROVIDERS) {
    if (p.id === "custom") continue;
    if (p.url && u.startsWith(p.url.toLowerCase().replace(/\/v1\/?$/, ""))) {
      return p;
    }
  }
  return AI_PROVIDERS[AI_PROVIDERS.length - 1]; // custom
}

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1/";
export const DEFAULT_CHINESE_MODEL = "gpt-4o-mini";

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  organization?: string;
}

export class LLMConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMConfigError";
  }
}

export interface LoadLLMConfigOptions {
  env?: NodeJS.ProcessEnv;
}

export function loadLLMConfig(options: LoadLLMConfigOptions = {}): LLMConfig {
  const env = options.env ?? process.env;
  const baseUrlRaw = env.OPENAI_BASE_URL?.trim();
  const apiKey = env.OPENAI_API_KEY?.trim();
  const providedModel = env.OPENAI_MODEL?.trim();
  const organization = env.OPENAI_ORG?.trim();

  if (!apiKey) {
    throw new LLMConfigError("请在环境变量 OPENAI_API_KEY 中配置访问密钥。");
  }

  const model = providedModel || DEFAULT_CHINESE_MODEL;

  if (!model) {
    throw new LLMConfigError("未能确定可用的中文模型，请设置 OPENAI_MODEL。");
  }

  const baseUrl = normaliseBaseUrl(baseUrlRaw || DEFAULT_OPENAI_BASE_URL);

  return {
    baseUrl,
    apiKey,
    model,
    organization,
  };
}

function normaliseBaseUrl(value: string): string {
  if (!value.endsWith("/")) {
    return `${value}/`;
  }
  return value;
}

export function buildChatCompletionsUrl(config: LLMConfig): URL {
  return new URL("chat/completions", config.baseUrl);
}

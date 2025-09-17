const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1/";

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
  const model = env.OPENAI_MODEL?.trim();
  const organization = env.OPENAI_ORG?.trim();

  if (!apiKey) {
    throw new LLMConfigError("OPENAI_API_KEY is not configured");
  }
  if (!model) {
    throw new LLMConfigError("OPENAI_MODEL is not configured");
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

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

let cachedConfig: LLMConfig | null = null;

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export function loadLLMConfig(): LLMConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const rawBaseUrl = process.env.OPENAI_BASE_URL?.trim();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim();

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable");
  }

  if (!model) {
    throw new Error("Missing OPENAI_MODEL environment variable");
  }

  const baseUrl = rawBaseUrl && rawBaseUrl.length > 0 ? rawBaseUrl.replace(/\/$/, "") : DEFAULT_BASE_URL;

  cachedConfig = { baseUrl, apiKey, model };
  return cachedConfig;
}

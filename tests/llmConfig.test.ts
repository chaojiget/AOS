import { describe, expect, it } from "vitest";

import { DEFAULT_CHINESE_MODEL, LLMConfigError, loadLLMConfig } from "../config/llm";

describe("loadLLMConfig", () => {
  it("falls back to the default chinese model when OPENAI_MODEL is missing", () => {
    const env = {
      NODE_ENV: "test",
      OPENAI_API_KEY: "key-123",
    } as NodeJS.ProcessEnv;

    const config = loadLLMConfig({ env });
    expect(config.model).toBe(DEFAULT_CHINESE_MODEL);
  });

  it("throws a chinese error message when api key is missing", () => {
    const env = { NODE_ENV: "test" } as NodeJS.ProcessEnv;
    try {
      loadLLMConfig({ env });
      throw new Error("expected loadLLMConfig to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(LLMConfigError);
      expect((error as Error).message).toBe("请在环境变量 OPENAI_API_KEY 中配置访问密钥。");
    }
  });

  it("uses the provided model when available", () => {
    const env = {
      NODE_ENV: "test",
      OPENAI_API_KEY: "key-abc",
      OPENAI_MODEL: "custom-zh-model",
    } as NodeJS.ProcessEnv;

    const config = loadLLMConfig({ env });
    expect(config.model).toBe("custom-zh-model");
  });
});

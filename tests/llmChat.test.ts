import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { APIConnectionTimeoutError } from "openai";

import { createDefaultToolInvoker, setOpenAiFactoryForTesting } from "../adapters/core";

const factoryConfigs: Array<{ apiKey: string; baseUrl: string; timeoutMs: number }> = [];
const createCalls: Array<{ params: any; options: any }> = [];

let nextResponse: any;
let nextError: unknown;
let previousEnv: Record<string, string | undefined>;

function installStubFactory() {
  setOpenAiFactoryForTesting((config, timeoutMs) => {
    factoryConfigs.push({ apiKey: config.apiKey, baseUrl: config.baseUrl, timeoutMs });
    return {
      chat: {
        completions: {
          async create(params: any, options: any) {
            createCalls.push({ params, options });
            if (nextError) {
              throw nextError;
            }
            return nextResponse;
          },
        },
      },
    };
  });
}

describe("llm.chat via OpenAI SDK", () => {
  beforeEach(() => {
    factoryConfigs.length = 0;
    createCalls.length = 0;
    nextResponse = undefined;
    nextError = undefined;
    previousEnv = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_MODEL: process.env.OPENAI_MODEL,
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
      OPENAI_TIMEOUT_MS: process.env.OPENAI_TIMEOUT_MS,
    };
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "gpt-test";
    process.env.OPENAI_BASE_URL = "https://example.com/v1/";
    delete process.env.OPENAI_TIMEOUT_MS;
    installStubFactory();
  });

  afterEach(() => {
    setOpenAiFactoryForTesting();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("returns ToolOk when the SDK responds", async () => {
    nextResponse = {
      id: "cmpl-test",
      model: "gpt-test",
      choices: [
        {
          message: { content: "你好" },
          finish_reason: "stop",
        },
      ],
      usage: { total_tokens: 42 },
    };

    const invoker = createDefaultToolInvoker({ enableRemoteMcp: false });
    const result = await invoker(
      { name: "llm.chat", args: { messages: [{ role: "user", content: "hi" }] } },
      { trace_id: "trace-1" },
    );

    expect(factoryConfigs).toHaveLength(1);
    expect(factoryConfigs[0]).toMatchObject({
      apiKey: "test-key",
      baseUrl: "https://example.com/v1/",
      timeoutMs: 30_000,
    });

    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].params).toMatchObject({
      model: "gpt-test",
      temperature: 0,
    });
    expect(createCalls[0].params.messages[0]).toEqual({ role: "user", content: "hi" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.content).toBe("你好");
      expect(typeof result.latency_ms).toBe("number");
      const latency = result.latency_ms ?? 0;
      expect(latency >= 0).toBe(true);
    }
  });

  test("propagates timeout errors as retryable ToolError", async () => {
    nextError = new APIConnectionTimeoutError({ message: "timeout" });

    const invoker = createDefaultToolInvoker({ enableRemoteMcp: false });
    const result = await invoker(
      { name: "llm.chat", args: { messages: [{ role: "user", content: "hi" }] } },
      { trace_id: "trace-2" },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("llm.timeout");
      expect(result.retryable).toBe(true);
    }
  });
});

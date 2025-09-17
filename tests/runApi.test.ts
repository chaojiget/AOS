import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextApiRequest, NextApiResponse } from "next";
import { describe, expect, it } from "vitest";

interface MockResponseState {
  statusCode: number;
  body?: any;
}

function createMockResponse(): { res: NextApiResponse; state: MockResponseState } {
  const state: MockResponseState = { statusCode: 0 };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(payload: any) {
      state.body = payload;
      return this;
    },
    setHeader() {
      return this;
    },
  } as unknown as NextApiResponse;
  return { res, state };
}

describe("POST /api/run", () => {
  it("records chat.msg events for history and final reply", async () => {
    const originalEnv = { ...process.env };
    const originalFetch = globalThis.fetch;
    const tempRoot = await mkdtemp(join(tmpdir(), "run-api-"));
    const originalCwd = process.cwd;
    (process as any).cwd = () => tempRoot;

    process.env = {
      ...originalEnv,
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "gpt-mock",
    };

    const fetchMock = async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        id: "chatcmpl-test",
        choices: [
          {
            message: { content: "Sure, I can help with that." },
            finish_reason: "stop",
          },
        ],
        model: "gpt-mock",
        usage: {},
      }),
      text: async () => "",
    } as Response);

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const { default: handler } = await import("../pages/api/run");

      const history = [
        { role: "system", content: "You are a helpful agent." },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ];

      const req = {
        method: "POST",
        body: { message: "How can you assist me today?", messages: history },
      } as unknown as NextApiRequest;

      const { res, state } = createMockResponse();

      await handler(req, res);

      expect(state.statusCode).toBe(200);
      expect(state.body?.trace_id).toBeTruthy();

      const traceId: string = state.body.trace_id;

      await new Promise((resolve) => setTimeout(resolve, 50));

      const logPath = join(tempRoot, "episodes", `${traceId}.jsonl`);
      const content = await readFile(logPath, "utf8");
      const chatEvents = content
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, any>)
        .filter((event) => event.type === "agent.chat.msg");

      expect(chatEvents).toHaveLength(history.length + 2);
      const roles = chatEvents.map((event) => event.data.role);
      expect(roles).toEqual([...history.map((msg) => msg.role), "user", "assistant"]);
      const assistantEvent = chatEvents.at(-1);
      expect((assistantEvent?.data.text ?? "").includes("Sure, I can help")).toBe(true);
      expect(assistantEvent?.data.role).toBe("assistant");
      expect(assistantEvent?.data.trace_id).toBe(traceId);
    } finally {
      (process as any).cwd = originalCwd;
      process.env = { ...originalEnv };
      if (originalFetch) {
        globalThis.fetch = originalFetch;
      } else {
        // @ts-expect-error deleting fetch when undefined
        delete globalThis.fetch;
      }
    }
  });
});

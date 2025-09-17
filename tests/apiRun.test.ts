import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";

function createResponseCapture() {
  let statusCode = 200;
  let jsonBody: any = null;
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(body: any) {
      jsonBody = body;
      return res;
    },
    setHeader() {
      return res;
    },
  } as unknown as NextApiResponse;

  return {
    res,
    get status() {
      return statusCode;
    },
    get body() {
      return jsonBody;
    },
  };
}

async function readFileWithRetry(path: string, attempts = 10, delayMs = 5): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await readFile(path, "utf8");
    } catch (error: any) {
      if (!error || error.code !== "ENOENT") {
        throw error;
      }
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function readEventsWithRetry(
  reader: (traceId: string) => Promise<any[]>,
  traceId: string,
  minLength: number,
  attempts = 20,
  delayMs = 5,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const events = await reader(traceId);
      if (events.length >= minLength) {
        return events;
      }
      lastError = new Error("insufficient events");
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function readIndexLinesWithRetry(
  path: string,
  expectedLength: number,
  attempts = 20,
  delayMs = 5,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const text = await readFile(path, "utf8");
      const lines = text.split("\n").filter(Boolean);
      if (lines.length >= expectedLength) {
        return lines;
      }
      lastError = new Error("index incomplete");
    } catch (error: any) {
      if (!error || error.code !== "ENOENT") {
        throw error;
      }
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

describe("POST /api/run", () => {
  it("reuses an existing trace when trace_id is provided", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "aos-trace-"));
    const originalCwd = process.cwd();
    const previousFetch = global.fetch;
    const prevApiKey = process.env.OPENAI_API_KEY;
    const prevModel = process.env.OPENAI_MODEL;

    try {
      process.chdir(tmpDir);
      process.env.OPENAI_API_KEY = "test-key";
      process.env.OPENAI_MODEL = "gpt-test";

      const responses = [
        {
          ok: true,
          status: 200,
          json: async () => ({
            id: "call-1",
            model: "gpt-test",
            choices: [{ message: { content: "first reply" }, finish_reason: "stop" }],
          }),
        },
        {
          ok: true,
          status: 200,
          json: async () => ({
            id: "call-2",
            model: "gpt-test",
            choices: [{ message: { content: "second reply" }, finish_reason: "stop" }],
          }),
        },
      ];
      let fetchCalls = 0;
      (globalThis as any).fetch = async () => {
        if (fetchCalls >= responses.length) {
          throw new Error("unexpected fetch call");
        }
        const response = responses[fetchCalls];
        fetchCalls += 1;
        return response as any;
      };

      const { default: handler } = await import("../pages/api/run");
      const { readEpisodeEvents } = await import("../lib/logflow");

      const invoke = async (body: Record<string, unknown>) => {
        const req = { method: "POST", body } as NextApiRequest;
        const capture = createResponseCapture();
        await handler(req, capture.res);
        return { status: capture.status, body: capture.body };
      };

      const first = await invoke({ message: "hello there", messages: [] });
      expect(first.status).toBe(200);
      expect(typeof first.body?.trace_id).toBe("string");
      const traceId = first.body.trace_id as string;
      expect(fetchCalls).toBe(1);

      const episodePath = join(tmpDir, "episodes", `${traceId}.jsonl`);
      const indexPath = join(tmpDir, "episodes", `${traceId}.index.jsonl`);
      await readFileWithRetry(episodePath);
      const initialEvents = await readEventsWithRetry(readEpisodeEvents, traceId, 1);
      expect(initialEvents.length > 0).toBe(true);
      const lastInitialLn = initialEvents.at(-1)?.ln ?? 0;

      const chatHistory = [
        { role: "user", content: "hello there" },
        {
          role: "assistant",
          content:
            typeof first.body?.result?.text === "string"
              ? first.body.result.text
              : JSON.stringify(first.body?.result ?? {}),
        },
      ];

      const second = await invoke({
        trace_id: traceId,
        message: "and now?",
        messages: chatHistory,
      });
      expect(second.status).toBe(200);
      expect(second.body?.trace_id).toBe(traceId);
      expect(fetchCalls).toBe(2);

      await readFileWithRetry(episodePath);
      const updatedEvents = await readEventsWithRetry(
        readEpisodeEvents,
        traceId,
        initialEvents.length + 1,
      );
      expect(updatedEvents.length > initialEvents.length).toBe(true);
      const lastUpdatedLn = updatedEvents.at(-1)?.ln ?? 0;
      expect(lastUpdatedLn > lastInitialLn).toBe(true);
      const indexLines = await readIndexLinesWithRetry(indexPath, updatedEvents.length);
      expect(indexLines.length).toBe(updatedEvents.length);

      const lineNumbers = updatedEvents.map((event) => event.ln);
      expect(lineNumbers).toEqual(
        [...lineNumbers].sort((a, b) => (a ?? 0) - (b ?? 0)),
      );
      const finalEvents = updatedEvents.filter((event) => event.type === "agent.final");
      expect(finalEvents.length >= 1).toBe(true);
      const lastFinal = finalEvents.at(-1);
      expect((lastFinal?.data as any)?.reason).toBe("completed");
    } finally {
      process.chdir(originalCwd);
      if (previousFetch) {
        (globalThis as any).fetch = previousFetch;
      } else {
        delete (globalThis as any).fetch;
      }
      if (prevApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = prevApiKey;
      }
      if (prevModel === undefined) {
        delete process.env.OPENAI_MODEL;
      } else {
        process.env.OPENAI_MODEL = prevModel;
      }
    }
  });
});


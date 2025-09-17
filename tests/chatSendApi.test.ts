import { join } from "node:path";
import { readFile, rm } from "node:fs/promises";
import type { NextApiRequest, NextApiResponse } from "next";
import vitestRuntime from "vitest";

type Hook = (fn: () => unknown | Promise<unknown>) => void;
type VitestRuntime = {
  describe: (name: string, fn: () => void) => void;
  it: (name: string, fn: () => unknown | Promise<unknown>) => void;
  expect: (received: unknown) => any;
  beforeEach: Hook;
  afterEach: Hook;
};

const runtime = vitestRuntime as VitestRuntime;
const { describe, it, expect, beforeEach, afterEach } = runtime;

import handler from "../pages/api/chat/send";

const episodesDir = join(process.cwd(), "episodes");

interface MockResponse<T = any> {
  statusCode: number;
  body: T | null;
}

function createMockResponse(): { res: NextApiResponse; record: MockResponse } {
  const record: MockResponse = { statusCode: 200, body: null };
  const res: Partial<NextApiResponse> = {
    status(code: number) {
      record.statusCode = code;
      return this as NextApiResponse;
    },
    json(payload: any) {
      record.body = payload;
      return this as NextApiResponse;
    },
    setHeader() {
      return this as NextApiResponse;
    },
  };
  return { res: res as NextApiResponse, record };
}

const tracesToClean = new Set<string>();
const originalFetch = global.fetch;

beforeEach(() => {
  tracesToClean.clear();
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_MODEL = "test-model";
  const fetchMock = async () =>
    new Response(
      JSON.stringify({
        id: "cmpl-test",
        choices: [
          {
            message: { content: "ok" },
            finish_reason: "stop",
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  global.fetch = fetchMock as any;
});

afterEach(async () => {
  if (originalFetch) {
    global.fetch = originalFetch;
  } else {
    delete (global as any).fetch;
  }
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  const removals = Array.from(tracesToClean).flatMap((traceId) => {
    const paths = [
      join(episodesDir, `${traceId}.jsonl`),
      join(episodesDir, `${traceId}.index.jsonl`),
    ];
    return paths.map((path) => rm(path, { force: true }).catch(() => {}));
  });
  await Promise.all(removals);
});

async function invokeHandler(body: any): Promise<MockResponse> {
  const req = { method: "POST", body } as unknown as NextApiRequest;
  const { res, record } = createMockResponse();
  await handler(req, res);
  if (typeof record.body?.trace_id === "string") {
    tracesToClean.add(record.body.trace_id);
  }
  return record;
}

function parseEpisode(traceId: string): Promise<any[]> {
  return readFile(join(episodesDir, `${traceId}.jsonl`), "utf8")
    .then((content) =>
      content
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as any),
    )
    .catch(() => []);
}

describe("POST /api/chat/send", () => {
  it("logs chat.msg events to the episode log", async () => {
    const record = await invokeHandler({ text: "hello" });
    expect(record.statusCode).toBe(200);
    expect(record.body === null).toBe(false);
    const responseTraceId = record.body?.trace_id as string;
    const responseMsgId = record.body?.msg_id as string;
    expect(typeof responseTraceId).toBe("string");
    expect(typeof responseMsgId).toBe("string");
    expect(Array.isArray(record.body?.events)).toBe(true);
    expect(record.body?.events?.[0]?.type).toBe("chat.msg");

    const events = await parseEpisode(responseTraceId);
    expect(events.length > 0).toBe(true);
    const first = events[0];
    expect(first.type).toBe("chat.msg");
    expect(first.trace_id).toBe(responseTraceId);
    expect(first.data).toMatchObject({
      msg_id: responseMsgId,
      role: "user",
      text: "hello",
      trace_id: responseTraceId,
      reply_to: null,
    });

    const indexContent = await readFile(join(episodesDir, `${responseTraceId}.index.jsonl`), "utf8");
    expect(indexContent.trim().length > 0).toBe(true);
  });

  it("reuses an existing trace id when provided", async () => {
    const first = await invokeHandler({ text: "hello there" });
    expect(first.statusCode).toBe(200);
    const traceId = first.body?.trace_id as string;
    expect(typeof traceId).toBe("string");

    const second = await invokeHandler({ text: "follow up", trace_id: traceId });
    expect(second.statusCode).toBe(200);
    expect(second.body?.trace_id).toBe(traceId);

    const events = await parseEpisode(traceId);
    const chatMessages = events.filter((evt) => evt.type === "chat.msg");
    expect(chatMessages.length >= 2).toBe(true);
    const latest = chatMessages.at(-1);
    expect(latest?.data?.text).toBe("follow up");
    expect(latest?.data?.trace_id).toBe(traceId);
  });
});

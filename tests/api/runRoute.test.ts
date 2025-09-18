import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";

import handler, { __resetLocalAppForTests } from "../../pages/api/run";
import runSummaryHandler from "../../pages/api/runs/[runId]/index";
import runEventsHandler from "../../pages/api/runs/[runId]/events";

interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  jsonBody: any;
  status: (code: number) => MockRes;
  setHeader: (key: string, value: string) => void;
  json: (body: any) => MockRes;
}

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

function resetEnv(): void {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
}

function createMockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    headers: {},
    jsonBody: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(key: string, value: string) {
      this.headers[key] = value;
    },
    json(body: any) {
      this.jsonBody = body;
      return this;
    },
  };
  return res;
}

describe("/api/run handler", () => {
  beforeEach(() => {
    resetEnv();
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await __resetLocalAppForTests();
  });

  it("proxies to the configured API base URL when available", async () => {
    const now = new Date().toISOString();
    const responses = [
      new Response(JSON.stringify({ runId: "remote-run" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
      new Response(JSON.stringify({ status: "completed", finalResult: { text: "ok" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      new Response(
        JSON.stringify({
          events: [
            {
              id: "evt-1",
              ts: now,
              type: "run.started",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
      new Response(JSON.stringify({ status: "completed", reason: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      new Response(
        JSON.stringify({
          events: [
            {
              id: "evt-1",
              ts: now,
              type: "run.started",
              data: { foo: "bar" },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ];
    const fetchCalls: any[] = [];
    global.fetch = (async (...args: any[]) => {
      const response = responses[fetchCalls.length];
      if (!response) {
        throw new Error("Unexpected fetch invocation");
      }
      fetchCalls.push(args);
      return response;
    }) as typeof global.fetch;
    process.env.AOS_API_BASE_URL = "https://api.example.com";

    const req = { method: "POST", body: { message: "hello" } } as unknown as NextApiRequest;
    const res = createMockRes();

    await handler(req, res as unknown as NextApiResponse);

    expect(fetchCalls.length >= 3).toBe(true);
    expect(res.statusCode).toBe(202);
    expect((res as any).jsonBody?.trace_id).toBe("remote-run");
    expect(Array.isArray((res as any).jsonBody?.events)).toBe(true);
    expect((res as any).jsonBody?.events?.[0]?.type).toBe("run.started");

    const summaryReq = {
      method: "GET",
      query: { runId: "remote-run" },
    } as unknown as NextApiRequest;
    const summaryRes = createMockRes();
    await runSummaryHandler(summaryReq, summaryRes as unknown as NextApiResponse);
    expect(summaryRes.statusCode).toBe(200);

    const eventsReq = {
      method: "GET",
      query: { runId: "remote-run" },
    } as unknown as NextApiRequest;
    const eventsRes = createMockRes();
    await runEventsHandler(eventsReq, eventsRes as unknown as NextApiResponse);
    expect(eventsRes.statusCode).toBe(200);
  });

  it("falls back to the embedded Nest app when no API base URL is configured", async () => {
    process.env.AOS_API_BASE_URL = "";
    process.env.AOS_USE_IN_MEMORY_DB = "1";
    let fetchCalled = false;
    global.fetch = (async () => {
      fetchCalled = true;
      throw new Error("fetch should not be called in fallback");
    }) as typeof global.fetch;

    const req = { method: "POST", body: { message: "hi" } } as unknown as NextApiRequest;
    const res = createMockRes();

    await handler(req, res as unknown as NextApiResponse);

    expect(fetchCalled).toBe(false);
    expect(res.statusCode).toBe(202);
    expect(typeof (res as any).jsonBody?.trace_id).toBe("string");
    const runId = (res as any).jsonBody?.trace_id as string;
    expect(Array.isArray((res as any).jsonBody?.events)).toBe(true);
    const eventTypes = (res as any).jsonBody?.events?.map((event: any) => event.type) ?? [];
    expect(eventTypes).toContain("run.started");

    const summaryRes = createMockRes();
    await runSummaryHandler(
      { method: "GET", query: { runId } } as unknown as NextApiRequest,
      summaryRes as unknown as NextApiResponse,
    );
    expect(summaryRes.statusCode).toBe(200);

    const eventsRes = createMockRes();
    await runEventsHandler(
      { method: "GET", query: { runId } } as unknown as NextApiRequest,
      eventsRes as unknown as NextApiResponse,
    );
    expect(eventsRes.statusCode).toBe(200);
  });
});

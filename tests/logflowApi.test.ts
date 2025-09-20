import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextApiRequest, NextApiResponse } from "next";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import branchHandler from "../pages/api/logflow/branch";
import mainlineHandler from "../pages/api/logflow/mainline";
import { EpisodeLogger } from "../runtime/episode";
import type { EventEnvelope } from "../runtime/events";

function createMockRes() {
  let statusCode: number | null = null;
  let payload: any = null;
  const headers: Record<string, string> = {};

  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(data: any) {
      payload = data;
      return this;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  } as unknown as NextApiResponse;

  return {
    res,
    getStatus: () => statusCode,
    getPayload: () => payload,
    getHeaders: () => headers,
  };
}

describe("LogFlow API", () => {
  const originalEpisodesDir = process.env.AOS_EPISODES_DIR;
  let workDir: string;
  let traceId: string;
  let events: EventEnvelope[];

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "aos-logflow-api-"));
    traceId = `trace-${Date.now()}`;
    process.env.AOS_EPISODES_DIR = workDir;

    events = [
      {
        id: "evt-1",
        ts: new Date(Date.UTC(2024, 0, 1, 0, 0, 0)).toISOString(),
        type: "run.started",
        version: 1,
        trace_id: traceId,
        span_id: "root-span",
        data: { runId: traceId },
      },
      {
        id: "evt-2",
        ts: new Date(Date.UTC(2024, 0, 1, 0, 0, 1)).toISOString(),
        type: "plan.updated",
        version: 1,
        trace_id: traceId,
        span_id: "root-span",
        data: { revision: 1, steps: [] },
      },
      {
        id: "evt-3",
        ts: new Date(Date.UTC(2024, 0, 1, 0, 0, 2)).toISOString(),
        type: "tool.started",
        version: 1,
        trace_id: traceId,
        span_id: "tool-span",
        parent_span_id: "root-span",
        data: { name: "search" },
      },
      {
        id: "evt-4",
        ts: new Date(Date.UTC(2024, 0, 1, 0, 0, 3)).toISOString(),
        type: "tool.succeeded",
        version: 1,
        trace_id: traceId,
        span_id: "tool-span",
        parent_span_id: "root-span",
        data: { name: "search", ok: true },
      },
      {
        id: "evt-5",
        ts: new Date(Date.UTC(2024, 0, 1, 0, 0, 4)).toISOString(),
        type: "run.finished",
        version: 1,
        trace_id: traceId,
        span_id: "root-span",
        data: { reason: "completed" },
      },
    ];

    const logger = new EpisodeLogger({ traceId, dir: workDir });
    for (const event of events) {
      await logger.append(event);
    }
  });

  afterEach(async () => {
    if (originalEpisodesDir === undefined) {
      delete process.env.AOS_EPISODES_DIR;
    } else {
      process.env.AOS_EPISODES_DIR = originalEpisodesDir;
    }
    await rm(workDir, { recursive: true, force: true });
  });

  it("returns mainline messages with index", async () => {
    const req = { method: "GET", query: { trace_id: traceId } } as unknown as NextApiRequest;
    const { res, getStatus, getPayload } = createMockRes();

    await mainlineHandler(req, res);

    expect(getStatus()).toBe(200);
    const body = getPayload();
    expect(body.trace_id).toBe(traceId);
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages.length).toBe(events.length);
    expect(body.index.length).toBe(events.length);
    const lineNumbers = body.messages.map((msg: any) => msg.ln);
    expect([...lineNumbers].sort((a: number, b: number) => a - b)).toEqual(lineNumbers);
  });

  it("returns branch view for a span", async () => {
    const req = {
      method: "GET",
      query: { trace_id: traceId, span_id: "tool-span" },
    } as unknown as NextApiRequest;
    const { res, getStatus, getPayload } = createMockRes();

    await branchHandler(req, res);

    expect(getStatus()).toBe(200);
    const body = getPayload();
    expect(body.trace_id).toBe(traceId);
    expect(body.origin.span_id).toBe("tool-span");
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages.length).toBe(2);
    expect(body.tree).toBeTruthy();
    expect(body.tree.span_id).toBe("tool-span");
  });

  it("infers span from message_id when missing", async () => {
    const req = {
      method: "GET",
      query: { trace_id: traceId, message_id: "evt-3" },
    } as unknown as NextApiRequest;
    const { res, getStatus, getPayload } = createMockRes();

    await branchHandler(req, res);

    expect(getStatus()).toBe(200);
    const body = getPayload();
    expect(body.origin.span_id).toBe("tool-span");
    expect(body.messages.length > 0).toBe(true);
  });
});

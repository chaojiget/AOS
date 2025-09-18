import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { describe, expect, it } from "vitest";

import handler from "../pages/api/runs/[runId]/stream";
import { createRunEvent, wrapCoreEvent, EventBus, type EventEnvelope } from "../runtime/events";
import { EpisodeLogger } from "../runtime/episode";
import { registerRun, markRunCompleted, removeRun } from "../runtime/runRegistry";

interface SseState {
  statusCode: number;
  headers: Map<string, string>;
  chunks: string[];
  ended: boolean;
  json?: unknown;
}

function createSseMocks(runId: string): {
  req: NextApiRequest & { emit: EventEmitter["emit"] };
  res: NextApiResponse;
  state: SseState;
  reqEmitter: EventEmitter;
  resEmitter: EventEmitter;
} {
  const reqEmitter = new EventEmitter();
  const resEmitter = new EventEmitter();
  const state: SseState = { statusCode: 0, headers: new Map(), chunks: [], ended: false };

  const req = {
    method: "GET",
    query: { runId },
    on: reqEmitter.on.bind(reqEmitter),
  } as unknown as NextApiRequest & { emit: EventEmitter["emit"] };
  req.emit = reqEmitter.emit.bind(reqEmitter);

  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string | number | readonly string[]) {
      const normalized = Array.isArray(value) ? value.join(",") : String(value);
      state.headers.set(name.toLowerCase(), normalized);
      return this;
    },
    write(chunk: any) {
      state.chunks.push(typeof chunk === "string" ? chunk : chunk?.toString?.() ?? "");
      return true;
    },
    end(chunk?: any) {
      if (chunk) {
        this.write(chunk);
      }
      state.ended = true;
      resEmitter.emit("close");
      return this;
    },
    flushHeaders() {
      /* noop */
    },
    json(payload: any) {
      state.json = payload;
      state.ended = true;
      return this;
    },
    on: resEmitter.on.bind(resEmitter),
    socket: {
      setKeepAlive() {
        /* noop */
      },
      setNoDelay() {
        /* noop */
      },
      on: resEmitter.on.bind(resEmitter),
    },
  } as unknown as NextApiResponse;

  return { req, res, state, reqEmitter, resEmitter };
}

function parseSse(chunks: string[]): Array<{ event: string; id?: string; data: any }> {
  const joined = chunks.join("");
  return joined
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n").filter((line) => line.trim().length > 0 && !line.startsWith(":"));
      const eventLine = lines.find((line) => line.startsWith("event:"));
      const idLine = lines.find((line) => line.startsWith("id:"));
      const dataLines = lines.filter((line) => line.startsWith("data:"));
      const dataRaw = dataLines.map((line) => line.slice(5).trim()).join("\n");
      return {
        event: eventLine ? eventLine.slice(6).trim() : "",
        id: idLine ? idLine.slice(3).trim() : undefined,
        data: dataRaw ? JSON.parse(dataRaw) : null,
      };
    });
}

describe("GET /api/runs/[runId]/stream", () => {
  it("streams historical and live events for an active run", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "run-stream-"));
    const prevDir = process.env.AOS_EPISODES_DIR;
    process.env.AOS_EPISODES_DIR = tmp;

    const runId = randomUUID();
    const bus = new EventBus();
    const logger = new EpisodeLogger({ traceId: runId, dir: tmp });
    bus.subscribe(async (event: EventEnvelope) => {
      await logger.append(event);
    });

    registerRun(runId, { bus, logger });

    try {
      await bus.publish(createRunEvent(runId, "run.started", { trace_id: runId }));

      const { req, res, state } = createSseMocks(runId);
      await handler(req, res);

      await bus.publish(
        wrapCoreEvent(
          runId,
          { type: "progress", step: "act", pct: 0.5 },
          { spanId: "plan-1", parentSpanId: runId },
        ),
      );
      await bus.publish(
        wrapCoreEvent(
          runId,
          { type: "final", outputs: { text: "done" }, reason: "completed" },
          { spanId: runId },
        ),
      );
      markRunCompleted(runId);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = parseSse(state.chunks);
      expect(state.statusCode).toBe(200);
      expect(state.headers.get("content-type")).toContain("text/event-stream");
      expect(events.some((evt) => evt.event === "run.started")).toBe(true);
      expect(events.some((evt) => evt.event === "run.progress")).toBe(true);
      const finished = events.find((evt) => evt.event === "run.finished");
      expect(finished?.data?.type).toBe("run.finished");
      expect(finished?.data?.data?.type).toBe("final");
      expect(finished?.data?.data?.reason).toBe("completed");
      const endEvent = events.find((evt) => evt.event === "stream.end");
      expect(endEvent?.data?.reason).toBe("run.finished");
      expect(state.ended).toBe(true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
      removeRun(runId);
      if (prevDir === undefined) {
        delete process.env.AOS_EPISODES_DIR;
      } else {
        process.env.AOS_EPISODES_DIR = prevDir;
      }
    }
  });

  it("replays stored events when run is completed", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "run-history-"));
    const prevDir = process.env.AOS_EPISODES_DIR;
    process.env.AOS_EPISODES_DIR = tmp;

    const runId = randomUUID();
    const logger = new EpisodeLogger({ traceId: runId, dir: tmp });

    try {
      await logger.append(createRunEvent(runId, "run.started", { trace_id: runId }));
      await logger.append(
        wrapCoreEvent(
          runId,
          { type: "final", outputs: { answer: 42 }, reason: "completed" },
          { spanId: runId },
        ),
      );

      const { req, res, state } = createSseMocks(runId);
      await handler(req, res);

      const events = parseSse(state.chunks);
      expect(state.statusCode).toBe(200);
      expect(state.ended).toBe(true);
      expect(events.map((evt) => evt.event)).toContain("run.started");
      expect(events.map((evt) => evt.event)).toContain("run.finished");
      const endEvent = events.find((evt) => evt.event === "stream.end");
      expect(endEvent?.data?.reason).toBe("run.finished");
    } finally {
      await rm(tmp, { recursive: true, force: true });
      if (prevDir === undefined) {
        delete process.env.AOS_EPISODES_DIR;
      } else {
        process.env.AOS_EPISODES_DIR = prevDir;
      }
    }
  });
});

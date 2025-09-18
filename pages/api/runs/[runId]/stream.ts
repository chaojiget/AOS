import type { NextApiRequest, NextApiResponse } from "next";
import { join } from "node:path";
import type { ServerResponse } from "http";

import { readEpisodeEvents } from "../../../../lib/logflow";
import type { EventEnvelope } from "../../../../runtime/events";
import { getRun } from "../../../../runtime/runRegistry";

const HEARTBEAT_INTERVAL_MS = 15_000;

function parseRunId(value: string | string[] | undefined): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string") {
    return value[0]?.trim() ?? null;
  }
  return null;
}

function writeEvent(res: ServerResponse, event: EventEnvelope): void {
  const payload = JSON.stringify(event);
  res.write(`event: ${event.type}\n`);
  res.write(`id: ${event.id}\n`);
  res.write(`data: ${payload}\n\n`);
}

function writeStreamEvent(res: ServerResponse, eventName: string, data: unknown): void {
  const payload = JSON.stringify(data ?? {});
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${payload}\n\n`);
}

function resolveEpisodesDir(): string {
  if (process.env.AOS_EPISODES_DIR) {
    return process.env.AOS_EPISODES_DIR;
  }
  return join(process.cwd(), "episodes");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "method_not_allowed", message: "only GET is allowed" });
    return;
  }

  const runId = parseRunId(req.query.runId);
  if (!runId || !/^[A-Za-z0-9-_.]+$/.test(runId)) {
    res.status(400).json({ error: "invalid_run_id", message: "runId must be a non-empty string" });
    return;
  }

  const episodesDir = resolveEpisodesDir();
  let history: EventEnvelope[] = [];
  try {
    history = await readEpisodeEvents(runId, episodesDir);
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      console.error("failed to read episode history", err);
      res.status(500).json({ error: "history_read_failed", message: err?.message ?? "unexpected error" });
      return;
    }
  }

  const runEntry = getRun(runId);
  if (!runEntry && history.length === 0) {
    res.status(404).json({ error: "run_not_found", message: `run ${runId} not found` });
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  const socket = res.socket;
  socket?.setKeepAlive?.(true);
  socket?.setNoDelay?.(true);

  (res as ServerResponse).flushHeaders?.();

  let closed = false;
  const serverRes = res as unknown as ServerResponse;

  for (const event of history) {
    writeEvent(serverRes, event);
  }

  if (!runEntry) {
    const lastType = history.at(-1)?.type ?? "history.complete";
    writeStreamEvent(serverRes, "stream.end", { reason: lastType });
    res.end();
    return;
  }

  const heartbeat = setInterval(() => {
    if (closed) {
      return;
    }
    serverRes.write(`: heartbeat ${Date.now()}\n\n`);
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  const unsubscribe = runEntry.bus.subscribe((event) => {
    if (closed || event.trace_id !== runId) {
      return;
    }
    writeEvent(serverRes, event);
    if (event.type === "run.finished" || event.type === "run.failed") {
      writeStreamEvent(serverRes, "stream.end", { reason: event.type });
      serverRes.end();
    }
  });

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  };

  req.on("close", close);
  req.on("aborted", close);
  serverRes.on("close", close);
}

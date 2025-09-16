import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { runLoop, type CoreEvent } from "../core/agent.js";
import { EventBus, wrapCoreEvent, type EventEnvelope } from "../runtime/events.js";
import { EpisodeLogger } from "../runtime/episode.js";
import { createChatKernel, createDefaultToolInvoker } from "../adapters/core.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const episodesDir = join(process.cwd(), "episodes");
const uiFile = join(process.cwd(), "ui", "index.html");

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  const payload = JSON.stringify(data);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

function sendText(res: ServerResponse, status: number, text: string, type = "text/plain") {
  res.statusCode = status;
  res.setHeader("Content-Type", `${type}; charset=utf-8`);
  res.setHeader("Content-Length", Buffer.byteLength(text));
  res.end(text);
}

async function handleRun(req: IncomingMessage, res: ServerResponse) {
  const bodyText = await readBody(req);
  let payload: any = {};
  if (bodyText) {
    try {
      payload = JSON.parse(bodyText);
    } catch {
      sendJson(res, 400, { error: "invalid_json", message: "request body must be valid json" });
      return;
    }
  }
  const message: string = payload.message ?? payload.input ?? "";
  const traceId = randomUUID();

  const bus = new EventBus();
  const logger = new EpisodeLogger({ traceId, dir: episodesDir });
  const toolInvoker = createDefaultToolInvoker();
  const kernel = createChatKernel({ message, traceId, toolInvoker });

  const events: EventEnvelope<CoreEvent>[] = [];
  bus.subscribe((event: any) => {
    events.push(event);
    logger.append(event).catch((err: any) => {
      console.error("failed to append episode event", err);
    });
  });

  const emit = (event: CoreEvent) => {
    bus.publish(wrapCoreEvent(traceId, event)).catch(console.error);
  };
  const result = await runLoop(kernel, emit, {
    context: { traceId, input: message },
  });

  sendJson(res, 200, {
    trace_id: traceId,
    result: result.final,
    events: events.map((evt) => ({
      ts: evt.ts,
      type: evt.type,
      data: evt.data,
    })),
  });
}

async function handleGetEpisode(res: ServerResponse, traceId: string) {
  try {
    const file = await readFile(join(episodesDir, `${traceId}.jsonl`), "utf8");
    sendText(res, 200, file);
  } catch (err: any) {
    if (err && err.code === "ENOENT") {
      sendJson(res, 404, { error: "not_found", message: `episode ${traceId} not found` });
      return;
    }
    sendJson(res, 500, { error: "read_failed", message: err?.message ?? "unknown error" });
  }
}

async function handleUi(res: ServerResponse) {
  try {
    const html = await readFile(uiFile, "utf8");
    sendText(res, 200, html, "text/html");
  } catch (err: any) {
    sendJson(res, 500, { error: "ui_missing", message: err?.message ?? "unable to read ui" });
  }
}

export const server = createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 400, { error: "invalid_request", message: "empty url" });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  try {
    if (req.method === "POST" && url.pathname === "/api/run") {
      await handleRun(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/episodes/")) {
      const traceId = url.pathname.split("/").pop() ?? "";
      await handleGetEpisode(res, traceId);
      return;
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/ui")) {
      await handleUi(res);
      return;
    }

    sendJson(res, 404, { error: "not_found", message: "route not found" });
  } catch (err: any) {
    console.error("request failed", err);
    sendJson(res, 500, { error: "internal_error", message: err?.message ?? "unknown error" });
  }
});

if (process.env.NODE_ENV !== "test") {
  server.listen(PORT, () => {
    console.log(`AgentOS dev server listening on http://localhost:${PORT}`);
  });
}

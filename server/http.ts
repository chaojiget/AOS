import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { runLoop, type CoreEvent } from "../core/agent";
import { EventBus, wrapCoreEvent } from "../runtime/events";
import { EpisodeLogger } from "../runtime/episode";
import { createChatKernel, createDefaultToolInvoker } from "../adapters/core";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const episodesDir = join(process.cwd(), "episodes");
const uiFile = join(process.cwd(), "ui", "index.html");

type StreamEvent = "event" | "complete" | "run-error";

interface StreamEventPayload {
  ts: string;
  type: string;
  data: CoreEvent;
}

interface StreamMessage {
  event: StreamEvent;
  data: StreamEventPayload | { final: any; reason: string } | { message: string };
}

class EventStreamBroker {
  private readonly clients = new Map<string, Set<ServerResponse>>();

  register(traceId: string, res: ServerResponse): () => void {
    let listeners = this.clients.get(traceId);
    if (!listeners) {
      listeners = new Set();
      this.clients.set(traceId, listeners);
    }
    listeners.add(res);
    return () => this.unregister(traceId, res);
  }

  send(traceId: string, event: StreamEvent, data: any) {
    const listeners = this.clients.get(traceId);
    if (!listeners || listeners.size === 0) return;
    for (const client of listeners) {
      this.write(client, event, data);
    }
  }

  replay(res: ServerResponse, messages: StreamMessage[]) {
    for (const message of messages) {
      this.write(res, message.event, message.data);
    }
  }

  close(traceId: string) {
    const listeners = this.clients.get(traceId);
    if (!listeners) return;
    for (const client of listeners) {
      if (!client.writableEnded) {
        client.end();
      }
    }
    this.clients.delete(traceId);
  }

  private unregister(traceId: string, res: ServerResponse) {
    const listeners = this.clients.get(traceId);
    if (!listeners) return;
    listeners.delete(res);
    if (listeners.size === 0) {
      this.clients.delete(traceId);
    }
  }

  private write(res: ServerResponse, event: StreamEvent, data: any) {
    if (res.writableEnded) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

const streamBroker = new EventStreamBroker();
const streamBuffers = new Map<string, StreamMessage[]>();

function scheduleBufferCleanup(traceId: string, delayMs: number) {
  const timer = setTimeout(() => {
    streamBuffers.delete(traceId);
  }, delayMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
}

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

  const eventBuffer: StreamMessage[] = [];
  streamBuffers.set(traceId, eventBuffer);

  bus.subscribe((event) => {
    const summary: StreamEventPayload = {
      ts: event.ts,
      type: event.type,
      data: event.data,
    };
    eventBuffer.push({ event: "event", data: summary });
    streamBroker.send(traceId, "event", summary);
    return logger.append(event).catch((err) => {
      console.error("failed to append episode event", err);
    });
  });

  const emit = (event: CoreEvent) => bus.publish(wrapCoreEvent(traceId, event));
  void runLoop(kernel, emit, {
    context: { traceId, input: message },
  })
    .then((result) => {
      const completePayload = { final: result.final, reason: result.reason };
      eventBuffer.push({ event: "complete", data: completePayload });
      streamBroker.send(traceId, "complete", completePayload);
      scheduleBufferCleanup(traceId, 60_000);
      streamBroker.close(traceId);
    })
    .catch((err) => {
      console.error("runLoop failed", err);
      const errorPayload = { message: err?.message ?? "run loop failed" };
      eventBuffer.push({ event: "run-error", data: errorPayload });
      streamBroker.send(traceId, "run-error", errorPayload);
      scheduleBufferCleanup(traceId, 60_000);
      streamBroker.close(traceId);
    });

  sendJson(res, 202, {
    trace_id: traceId,
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

function handleEventStream(req: IncomingMessage, res: ServerResponse, traceId: string) {
  if (!traceId) {
    sendJson(res, 400, { error: "invalid_trace", message: "trace id is required" });
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.write(": connected\n\n");

  const cleanup = streamBroker.register(traceId, res);
  const backlog = streamBuffers.get(traceId);
  if (backlog && backlog.length > 0) {
    streamBroker.replay(res, backlog);
  }

  req.on("close", () => {
    cleanup();
  });
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

    if (
      req.method === "GET" &&
      url.pathname.startsWith("/api/run/") &&
      url.pathname.endsWith("/events")
    ) {
      const segments = url.pathname.split("/");
      const traceId = segments.length >= 4 ? segments[3] : "";
      handleEventStream(req, res, traceId);
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

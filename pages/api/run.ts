import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { createChatKernel, createDefaultToolInvoker } from "../../adapters/core";
import { runLoop, type CoreEvent } from "../../core/agent";
import { EpisodeLogger } from "../../runtime/episode";
import { EventBus, wrapCoreEvent, type EventEnvelope } from "../../runtime/events";

interface RunResponse {
  trace_id: string;
  result: unknown;
  events: Array<{ ts: string; type: string; data: CoreEvent }>;
}

const episodesDir = join(process.cwd(), "episodes");

function parseRequestBody(req: NextApiRequest): Record<string, unknown> {
  const { body } = req;
  if (body == null || body === "") {
    return {};
  }

  if (typeof body === "string") {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      throw new Error("invalid_json");
    }
  }

  if (typeof body === "object") {
    return body as Record<string, unknown>;
  }

  return {};
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RunResponse | { error: string; message: string }>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method_not_allowed", message: "only POST is allowed" });
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = parseRequestBody(req);
  } catch {
    res.status(400).json({ error: "invalid_json", message: "request body must be valid json" });
    return;
  }

  const messageRaw = payload.message ?? payload.input ?? "";
  const message = typeof messageRaw === "string" ? messageRaw : "";
  const traceId = randomUUID();

  const bus = new EventBus();
  const logger = new EpisodeLogger({ traceId, dir: episodesDir });
  const toolInvoker = createDefaultToolInvoker();
  const kernel = createChatKernel({ message, traceId, toolInvoker });

  const events: EventEnvelope<CoreEvent>[] = [];
  bus.subscribe((event) => {
    events.push(event);
    return logger.append(event).catch((error) => {
      console.error("failed to append episode event", error);
    });
  });

  try {
    const emit = (event: CoreEvent) => bus.publish(wrapCoreEvent(traceId, event));
    const result = await runLoop(kernel, emit, {
      context: { traceId, input: message },
    });

    res.status(200).json({
      trace_id: traceId,
      result: result.final,
      events: events.map((evt) => ({
        ts: evt.ts,
        type: evt.type,
        data: evt.data,
      })),
    });
  } catch (err) {
    console.error("request failed", err);
    const message = err instanceof Error ? err.message : "unknown error";
    res.status(500).json({ error: "internal_error", message });
  }
}

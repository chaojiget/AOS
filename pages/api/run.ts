import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { createChatKernel, createDefaultToolInvoker } from "../../adapters/core";
import { runLoop, type CoreEvent, type EmitSpanOptions } from "../../core/agent";
import { EpisodeLogger } from "../../runtime/episode";
import { EventBus, wrapCoreEvent, type EventEnvelope } from "../../runtime/events";

interface RunResponse {
  trace_id: string;
  result: unknown;
  events: Array<{ ts: string; type: string; data: CoreEvent }>;
}

const episodesDir = join(process.cwd(), "episodes");

type RequestMessage = { role: string; content: string };

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

function normaliseHistory(raw: unknown): RequestMessage[] {
  if (!Array.isArray(raw)) return [];
  const history: RequestMessage[] = [];
  for (const entry of raw) {
    if (entry && typeof entry === "object" && typeof (entry as any).role === "string") {
      const content = (entry as any).content;
      if (typeof content === "string") {
        history.push({ role: (entry as any).role, content });
      }
    }
  }
  return history;
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
  const history = normaliseHistory(payload.messages);
  const traceIdInput = typeof payload.trace_id === "string" ? payload.trace_id.trim() : undefined;
  const traceId = traceIdInput && traceIdInput.length > 0 ? traceIdInput : randomUUID();

  const bus = new EventBus();
  const logger = new EpisodeLogger({ traceId, dir: episodesDir });
  const toolInvoker = createDefaultToolInvoker();
  const kernel = createChatKernel({ message, traceId, toolInvoker, history });

  const events: EventEnvelope<CoreEvent>[] = [];
  bus.subscribe((event: EventEnvelope<CoreEvent>) => {
    events.push(event);
    void logger.append(event).catch((error: unknown) => {
      console.error("failed to append episode event", error);
    });
  });

  try {
    const emit = async (event: CoreEvent, span?: EmitSpanOptions): Promise<void> => {
      await bus.publish(wrapCoreEvent(traceId, event, span));
    };

    let lastPublishedKey: string | undefined;
    let lastUserMessageId: string | undefined;

    const publishChatMessage = async (role: string, text: string): Promise<string | undefined> => {
      const normalizedText = typeof text === "string" ? text : "";
      const key = `${role}:${normalizedText}`;
      if (key === lastPublishedKey) {
        return undefined;
      }
      lastPublishedKey = key;
      const msgId = randomUUID();
      await emit({
        type: "chat.msg",
        msg_id: msgId,
        role,
        text: normalizedText,
        trace_id: traceId,
      });
      if (role === "user") {
        lastUserMessageId = msgId;
      }
      return msgId;
    };

    for (const entry of history) {
      await publishChatMessage(entry.role, entry.content);
    }

    if (message) {
      await publishChatMessage("user", message);
    }

    const result = await runLoop(kernel, emit, {
      context: { traceId, input: message },
    });

    if (result.final !== undefined) {
      const assistantText = normaliseAssistantText(result.final);
      await emit({
        type: "chat.msg",
        msg_id: randomUUID(),
        role: "assistant",
        text: assistantText,
        trace_id: traceId,
        ...(lastUserMessageId ? { reply_to: lastUserMessageId } : {}),
      });
    }

    res.status(200).json({
      trace_id: traceId,
      result: result.final,
      events: events.map((evt: EventEnvelope<CoreEvent>) => ({
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

function normaliseAssistantText(finalOutput: unknown): string {
  if (finalOutput == null) {
    return "";
  }
  if (typeof finalOutput === "string") {
    return finalOutput;
  }
  if (typeof finalOutput === "object") {
    if (typeof (finalOutput as any).text === "string") {
      return (finalOutput as any).text;
    }
    if (typeof (finalOutput as any).content === "string") {
      return (finalOutput as any).content;
    }
    try {
      return JSON.stringify(finalOutput);
    } catch {
      return String(finalOutput);
    }
  }
  return String(finalOutput);
}

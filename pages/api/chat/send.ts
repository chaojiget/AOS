import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { createChatKernel, createDefaultToolInvoker } from "../../../adapters/core";
import { runLoop, type CoreEvent } from "../../../core/agent";
import { EpisodeLogger } from "../../../runtime/episode";
import { EventBus, type EventEnvelope, wrapCoreEvent } from "../../../runtime/events";

interface ChatSendResponse {
  trace_id: string;
  msg_id: string;
  result: unknown;
  events: Array<{ ts: string; type: string; data: unknown }>;
}

const episodesDir = process.env.AOS_EPISODES_DIR ?? join(process.cwd(), "episodes");

type RequestMessage = { role: string; content: string };

type ChatSendError = { error: string; message: string };

type ParsedBody = Record<string, unknown>;

function parseRequestBody(req: NextApiRequest): ParsedBody {
  const { body } = req;
  if (body == null || body === "") {
    return {};
  }

  if (typeof body === "string") {
    try {
      return JSON.parse(body) as ParsedBody;
    } catch {
      throw new Error("invalid_json");
    }
  }

  if (typeof body === "object") {
    return body as ParsedBody;
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

function normaliseText(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (raw && typeof raw === "object" && typeof (raw as any).content === "string") {
    return (raw as any).content;
  }
  return "";
}

function normaliseTraceId(raw: unknown): string | undefined {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed ? trimmed : undefined;
  }
  return undefined;
}

function normaliseReplyTo(raw: unknown): string | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  }
  return null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ChatSendResponse | ChatSendError>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method_not_allowed", message: "only POST is allowed" });
    return;
  }

  let payload: ParsedBody;
  try {
    payload = parseRequestBody(req);
  } catch {
    res.status(400).json({ error: "invalid_json", message: "request body must be valid json" });
    return;
  }

  const history = normaliseHistory(payload.messages);
  const text = normaliseText(payload.text ?? payload.message ?? payload.input);

  if (!text.trim()) {
    res.status(400).json({ error: "invalid_input", message: "text is required" });
    return;
  }

  const providedTraceId = normaliseTraceId(payload.trace_id ?? (payload as any).traceId);
  const traceId = providedTraceId ?? randomUUID();
  const msgId = randomUUID();
  const replyTo = normaliseReplyTo(payload.reply_to ?? (payload as any).replyTo);

  const bus = new EventBus();
  const logger = new EpisodeLogger({ traceId, dir: episodesDir });
  const toolInvoker = createDefaultToolInvoker();
  const kernel = createChatKernel({ message: text, traceId, toolInvoker, history });

  const events: EventEnvelope[] = [];
  bus.subscribe(async (event: EventEnvelope) => {
    events.push(event);
    try {
      await logger.append(event);
    } catch (error) {
      console.error("failed to append episode event", error);
    }
  });

  const chatMessageEnvelope: EventEnvelope = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    type: "chat.msg",
    version: 1,
    trace_id: traceId,
    data: {
      msg_id: msgId,
      role: "user",
      text,
      reply_to: replyTo,
      trace_id: traceId,
    },
  };

  try {
    await bus.publish(chatMessageEnvelope);

    const emit = async (event: CoreEvent): Promise<void> => {
      await bus.publish(wrapCoreEvent(traceId, event));
    };

    const result = await runLoop(kernel, emit, {
      context: { traceId, input: text, metadata: { history } },
    });

    res.status(200).json({
      trace_id: traceId,
      msg_id: msgId,
      result: result.final,
      events: events.map((evt: EventEnvelope) => ({
        ts: evt.ts,
        type: evt.type,
        data: evt.data,
      })),
    });
  } catch (err) {
    console.error("chat send request failed", err);
    const message = err instanceof Error ? err.message : "unknown error";
    res.status(500).json({ error: "internal_error", message });
  }
}

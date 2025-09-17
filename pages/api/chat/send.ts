import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { createChatKernel, createDefaultToolInvoker } from "../../../adapters/core";
import { runLoop, type CoreEvent, type EmitSpanOptions } from "../../../core/agent";
import { EpisodeLogger } from "../../../runtime/episode";
import { EventBus, type EventEnvelope, wrapCoreEvent } from "../../../runtime/events";

interface ChatSendResponse {
  trace_id: string;
  msg_id: string;
  result: unknown;
  message: {
    msg_id: string;
    role: "assistant";
    trace_id: string;
    reply_to: string;
    text?: string;
    error?: unknown;
    raw?: unknown;
  };
  events: Array<{
    ts: string;
    type: string;
    span_id?: string;
    parent_span_id?: string;
    data: unknown;
  }>;
}

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
    res
      .status(405)
      .json({ error: "method_not_allowed", message: "仅支持 POST 请求" });
    return;
  }

  let payload: ParsedBody;
  try {
    payload = parseRequestBody(req);
  } catch {
    res
      .status(400)
      .json({ error: "invalid_json", message: "请求体必须是合法的 JSON" });
    return;
  }

  const history = normaliseHistory(payload.messages);
  const text = normaliseText(payload.text ?? payload.message ?? payload.input);

  if (!text.trim()) {
    res.status(400).json({ error: "invalid_input", message: "必须提供文本内容" });
    return;
  }

  const providedTraceId = normaliseTraceId(payload.trace_id ?? (payload as any).traceId);
  const traceId = providedTraceId ?? randomUUID();
  const msgId = randomUUID();
  const replyTo = normaliseReplyTo(payload.reply_to ?? (payload as any).replyTo);

  const episodesDir = process.env.AOS_EPISODES_DIR ?? join(process.cwd(), "episodes");

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

    const emit = async (event: CoreEvent, span?: EmitSpanOptions): Promise<void> => {
      await bus.publish(wrapCoreEvent(traceId, event, span));
    };

    const result = await runLoop(kernel, emit, {
      context: { traceId, input: text, metadata: { history } },
    });

    const assistantMsgId = randomUUID();
    const assistantPayload: {
      msg_id: string;
      role: "assistant";
      trace_id: string;
      reply_to: string;
      text?: string;
      error?: unknown;
      raw?: unknown;
    } = {
      msg_id: assistantMsgId,
      role: "assistant",
      trace_id: traceId,
      reply_to: msgId,
    };

    const final = result?.final;
    if (final && typeof final === "object") {
      if (typeof (final as any).text === "string") {
        assistantPayload.text = (final as any).text;
      }
      if ("error" in final) {
        assistantPayload.error = (final as any).error;
      }
      if ("raw" in final) {
        assistantPayload.raw = (final as any).raw;
      }
    } else if (typeof final === "string") {
      assistantPayload.text = final;
    } else if (final != null) {
      assistantPayload.text = JSON.stringify(final);
    } else if (result?.reason) {
      assistantPayload.error = { reason: result.reason };
    }

    await bus.publish({
      id: randomUUID(),
      ts: new Date().toISOString(),
      type: "chat.msg",
      version: 1,
      trace_id: traceId,
      data: assistantPayload,
    });

    res.status(200).json({
      trace_id: traceId,
      msg_id: msgId,
      result: result.final,
      message: assistantPayload,
      events: events.map((evt: EventEnvelope) => ({
        ts: evt.ts,
        type: evt.type,
        span_id: evt.span_id,
        parent_span_id: evt.parent_span_id,
        data: evt.data,
      })),
    });
  } catch (err) {
    console.error("chat send request failed", err);
    const message = err instanceof Error ? err.message : "unknown error";
    res
      .status(500)
      .json({ error: "internal_error", message: `服务器内部错误：${message}` });
  }
}

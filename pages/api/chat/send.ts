import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { createChatKernel, createDefaultToolInvoker } from "../../../adapters/core";
import { runLoop, type CoreEvent, type EmitSpanOptions } from "../../../core/agent";
import { EpisodeLogger } from "../../../runtime/episode";
import { EventBus, type EventEnvelope, wrapCoreEvent } from "../../../runtime/events";

type RunReason = "completed" | "no-plan" | "ask" | "max-iterations";

interface ChatSendResponse {
  trace_id: string;
  msg_id: string;
  result: unknown;
  reason: RunReason;
  review?: unknown;
  message: AssistantEventPayload | null;
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

type AssistantMessagePayload = {
  msg_id: string;
  ts: string;
  text?: string;
  error?: string;
};

type AssistantEventPayload = {
  msg_id: string;
  role: "assistant";
  trace_id: string;
  reply_to: string;
  ts: string;
  text?: string;
  error?: unknown;
  raw?: unknown;
};

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

function normaliseAssistantMessage(
  finalOutput: unknown,
  reason: RunReason,
  review: unknown,
): AssistantMessagePayload | null {
  const base: AssistantMessagePayload = {
    msg_id: randomUUID(),
    ts: new Date().toISOString(),
  };

  if (finalOutput == null) {
    if (reason === "completed") {
      return null;
    }

    const reviewNotes = Array.isArray((review as any)?.notes)
      ? ((review as any).notes as unknown[]).filter((note): note is string => typeof note === "string")
      : [];
    const noteSummary = reviewNotes.join(" · ");
    const message = noteSummary || `run ended with reason: ${reason}`;
    return { ...base, error: message };
  }

  if (typeof finalOutput === "string") {
    const text = finalOutput.trim();
    if (!text) {
      return { ...base, text: "" };
    }
    return { ...base, text };
  }

  if (typeof finalOutput === "object") {
    const record = finalOutput as Record<string, unknown>;
    const msgId =
      typeof record.msg_id === "string" && record.msg_id.trim()
        ? record.msg_id.trim()
        : base.msg_id;
    const ts = typeof record.ts === "string" && record.ts.trim() ? record.ts : base.ts;

    const textValue = typeof record.text === "string" ? record.text : undefined;
    const errorValue = record.error;
    const errorText =
      typeof errorValue === "string"
        ? errorValue
        : errorValue && typeof errorValue === "object"
          ? typeof (errorValue as any).message === "string"
            ? (errorValue as any).message
            : JSON.stringify(errorValue)
          : undefined;

    if (textValue || errorText) {
      return {
        msg_id: msgId,
        ts,
        ...(textValue ? { text: textValue } : {}),
        ...(errorText ? { error: errorText } : {}),
      };
    }

    return {
      msg_id: msgId,
      ts,
      text: JSON.stringify(finalOutput),
    };
  }

  return {
    ...base,
    text: String(finalOutput),
  };
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

    const finalOutput = result?.final;
    const runReason = (result?.reason ?? "completed") as RunReason;
    const review = result?.review;

    const assistantMessage = normaliseAssistantMessage(finalOutput, runReason, review);

    let assistantPayload: AssistantEventPayload | null = assistantMessage
      ? {
          msg_id: assistantMessage.msg_id,
          role: "assistant",
          trace_id: traceId,
          reply_to: msgId,
          ts: assistantMessage.ts,
          ...(assistantMessage.text ? { text: assistantMessage.text } : {}),
          ...(assistantMessage.error ? { error: assistantMessage.error } : {}),
        }
      : null;

    if (!assistantPayload) {
      assistantPayload = {
        msg_id: randomUUID(),
        role: "assistant",
        trace_id: traceId,
        reply_to: msgId,
        ts: new Date().toISOString(),
      };
    }

    if (finalOutput && typeof finalOutput === "object") {
      if (typeof (finalOutput as any).text === "string" && assistantPayload.text == null) {
        assistantPayload.text = (finalOutput as any).text;
      }
      if ("error" in finalOutput && assistantPayload.error == null) {
        assistantPayload.error = (finalOutput as any).error;
      }
      if ("raw" in finalOutput) {
        assistantPayload.raw = (finalOutput as any).raw;
      }
    } else if (typeof finalOutput === "string" && assistantPayload.text == null) {
      assistantPayload.text = finalOutput;
    } else if (
      finalOutput != null &&
      assistantPayload.text == null &&
      assistantPayload.error == null
    ) {
      assistantPayload.text = JSON.stringify(finalOutput);
    }

    if (assistantPayload.text == null && assistantPayload.error == null) {
      if (runReason !== "completed") {
        assistantPayload.error = { reason: runReason };
      } else {
        assistantPayload.text = "";
      }
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
      result: finalOutput,
      reason: runReason,
      review,
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

import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { createChatKernel, createDefaultToolInvoker } from "../../adapters/core";
import {
  runLoop,
  type CoreEvent,
  type EmitSpanOptions,
  type RunLoopResult,
} from "../../core/agent";
import { EpisodeLogger } from "../../runtime/episode";
import {
  EventBus,
  wrapCoreEvent,
  createRunEvent,
  type EventEnvelope,
} from "../../runtime/events";
import { markRunCompleted, markRunFailed, registerRun } from "../../runtime/runRegistry";

interface RunResponse {
  trace_id: string;
  result: unknown;
  reason: RunResultReason;
  events: Array<{
    ts: string;
    type: string;
    span_id?: string;
    parent_span_id?: string;
    data: CoreEvent;
  }>;
}

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

type RunResultReason = RunLoopResult["reason"];

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

  const episodesDir = process.env.AOS_EPISODES_DIR ?? join(process.cwd(), "episodes");

  const bus = new EventBus();
  const logger = new EpisodeLogger({ traceId, dir: episodesDir });
  const toolInvoker = createDefaultToolInvoker({ eventBus: bus });
  const kernel = createChatKernel({ message, traceId, toolInvoker, history });

  const events: EventEnvelope<CoreEvent>[] = [];
  bus.subscribe(async (event: EventEnvelope<CoreEvent>) => {
    events.push(event);
    try {
      await logger.append(event);
    } catch (error: unknown) {
      console.error("failed to append episode event", error);
    }
  });

  registerRun(traceId, { bus, logger });

  try {
    await bus.publish(
      createRunEvent(traceId, "run.started", {
        trace_id: traceId,
        input: message,
        history_length: history.length,
      }),
    );

    const emit = async (event: CoreEvent, span?: EmitSpanOptions): Promise<void> => {
      await bus.publish(wrapCoreEvent(traceId, event, span));
    };

    const publishChatMessage = async (
      role: string,
      text: string,
      options: { reply_to?: string } = {},
    ): Promise<string> => {
      const normalized = typeof text === "string" ? text.trim() : "";
      const msgId = randomUUID();
      const envelope: EventEnvelope = {
        id: randomUUID(),
        ts: new Date().toISOString(),
        type: "chat.msg",
        version: 1,
        trace_id: traceId,
        data: {
          msg_id: msgId,
          role,
          text: normalized,
          trace_id: traceId,
          ...(options.reply_to ? { reply_to: options.reply_to } : {}),
        },
      };
      await bus.publish(envelope);
      return msgId;
    };

    let lastUserMessageId: string | undefined;
    for (const entry of history) {
      const msgId = await publishChatMessage(entry.role, entry.content, {
        reply_to: entry.role === "assistant" ? lastUserMessageId : undefined,
      });
      if (entry.role === "user") {
        lastUserMessageId = msgId;
      }
    }

    if (message) {
      lastUserMessageId = await publishChatMessage("user", message, {
        reply_to: lastUserMessageId,
      });
    }

    const result = await runLoop(kernel, emit, {
      context: { traceId, input: message },
    });

    const assistantText = normaliseAssistantText(result.final);
    if (assistantText) {
      await publishChatMessage("assistant", assistantText, {
        reply_to: lastUserMessageId,
      });
    }

    markRunCompleted(traceId);

    res.status(200).json({
      trace_id: traceId,
      result: result.final,
      reason: result.reason,
      events: events.map((evt) => ({
        ts: evt.ts,
        type: evt.type,
        span_id: evt.span_id,
        parent_span_id: evt.parent_span_id,
        data: evt.data,
      })),
    });
  } catch (err) {
    console.error("request failed", err);
    const message = err instanceof Error ? err.message : "unknown error";
    await bus.publish(
      createRunEvent(traceId, "run.failed", { message, trace_id: traceId }),
    );
    markRunFailed(traceId);
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

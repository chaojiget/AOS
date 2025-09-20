import { randomUUID } from "node:crypto";
import type { CoreEvent, EventMetadata } from "../core/agent";

export interface EventEnvelope<T = any> {
  id: string;
  ts: string;
  type: string;
  version: number;
  trace_id: string;
  span_id?: string;
  parent_span_id?: string;
  topic?: string;
  level?: "debug" | "info" | "warn" | "error";
  data: T;
  ln?: number;
  byte_offset?: number;
}

export type EventSubscriber = (event: EventEnvelope) => void | Promise<void>;

export interface EventBusOptions {
  version?: number;
}

export class EventBus {
  private subscribers = new Set<EventSubscriber>();
  private sequence = 0;

  constructor(private readonly options: EventBusOptions = {}) {}

  subscribe(sub: EventSubscriber): () => void {
    this.subscribers.add(sub);
    return () => {
      this.subscribers.delete(sub);
    };
  }

  async publish<T>(envelope: EventEnvelope<T>): Promise<EventEnvelope<T>> {
    const enriched = envelope;
    enriched.id = enriched.id || randomUUID();
    enriched.ts = enriched.ts || new Date().toISOString();
    enriched.version = enriched.version ?? this.options.version ?? 1;
    enriched.ln = enriched.ln ?? ++this.sequence;

    for (const sub of this.subscribers) {
      await sub(enriched);
    }

    return enriched;
  }
}

export interface WrapEventOptions extends EventMetadata {
  version?: number;
}

function mapCoreEventType(event: CoreEvent): string {
  switch (event.type) {
    case "plan":
      return "plan.updated";
    case "tool":
      if (event.status === "started") {
        return "tool.started";
      }
      if (event.status === "failed") {
        return "tool.failed";
      }
      if (event.status === "succeeded") {
        return "tool.succeeded";
      }
      return event.result && event.result.ok === false ? "tool.failed" : "tool.succeeded";
    case "progress":
      return "run.progress";
    case "final":
      return "final.answer";
    case "terminated":
      return "run.terminated";
    case "log":
      return "run.log";
    case "ask":
      return "run.ask";
    case "score":
      return "run.score";
    default:
      return event.type;
  }
}

function enrichEventData(event: CoreEvent): CoreEvent {
  if (event.type === "tool") {
    const status =
      event.status ?? (event.result && event.result.ok === false ? "failed" : "succeeded");
    return { ...event, status };
  }
  return event;
}

export function wrapCoreEvent(
  traceId: string,
  event: CoreEvent,
  options: WrapEventOptions = {},
): EventEnvelope<CoreEvent> {
  const level =
    options.level ??
    (event.type === "log" ? (event.level as WrapEventOptions["level"]) : undefined);
  return {
    id: randomUUID(),
    ts: new Date().toISOString(),
    type: mapCoreEventType(event),
    version: options.version ?? 1,
    trace_id: traceId,
    span_id: options.spanId,
    parent_span_id: options.parentSpanId,
    topic: options.topic,
    level,
    data: enrichEventData(event),
  };
}

export function createRunEvent(
  traceId: string,
  type: string,
  data: Record<string, unknown> = {},
  options: WrapEventOptions = {},
): EventEnvelope<Record<string, unknown>> {
  return {
    id: randomUUID(),
    ts: new Date().toISOString(),
    type,
    version: options.version ?? 1,
    trace_id: traceId,
    span_id: options.spanId,
    parent_span_id: options.parentSpanId,
    topic: options.topic,
    level: options.level,
    data,
  };
}

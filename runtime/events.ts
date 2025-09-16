import { randomUUID } from 'node:crypto';
import type { CoreEvent } from '../core/agent';

export interface EventEnvelope<T = any> {
  id: string;
  ts: string;
  type: string;
  version: number;
  trace_id: string;
  span_id?: string;
  parent_span_id?: string;
  topic?: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  data: T;
  ln?: number;
  byte_offset?: number;
}

export type EventSubscriber = (
  event: EventEnvelope
) => void | Promise<void>;

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

export interface WrapEventOptions {
  spanId?: string;
  parentSpanId?: string;
  topic?: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  version?: number;
}

export function wrapCoreEvent(
  traceId: string,
  event: CoreEvent,
  options: WrapEventOptions = {}
): EventEnvelope<CoreEvent> {
  return {
    id: randomUUID(),
    ts: new Date().toISOString(),
    type: `agent.${event.type}`,
    version: options.version ?? 1,
    trace_id: traceId,
    span_id: options.spanId,
    parent_span_id: options.parentSpanId,
    topic: options.topic,
    level: options.level,
    data: event,
  };
}

import { createHash, randomUUID } from "node:crypto";

import type { ToolError, ToolOk, ToolResult } from "../core/agent";
import type { EventBus, EventEnvelope } from "../runtime/events";
import { McpCoreServer, type McpServer, type McpCoreServerOptions } from "../servers/mcp-core";

export type McpMode = "live" | "replay";

export interface McpAdapterOptions {
  traceId: string;
  bus: EventBus;
  mode?: McpMode;
  recordedEvents?: EventEnvelope[];
}

export interface McpCallOptions {
  spanId?: string;
  parentSpanId?: string;
  topic?: string;
}

interface McpCallEventData {
  server: string;
  tool: string;
  args_hash: string;
  args_preview?: string;
}

interface McpResultEventData {
  server: string;
  tool: string;
  args_hash: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
  };
  latency_ms?: number;
  cost?: number;
}

interface RecordedPair {
  call: EventEnvelope<McpCallEventData>;
  result: EventEnvelope<McpResultEventData>;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return '"[unserializable]"';
  }
}

function hashArgs(args: unknown): string {
  return createHash("sha256").update(safeStringify(args)).digest("hex");
}

function buildArgsPreview(args: unknown): string | undefined {
  if (args == null) return undefined;
  const serialized = safeStringify(args);
  if (serialized.length <= 512) {
    return serialized;
  }
  return `${serialized.slice(0, 509)}...`;
}

function cloneEnvelope<T>(event: EventEnvelope<T>): EventEnvelope<T> {
  return JSON.parse(JSON.stringify(event)) as EventEnvelope<T>;
}

function extractToolError(result: ToolResult): ToolError | null {
  if (result.ok) return null;
  return result;
}

function mergeLatency(result: ToolResult, latencyMs: number): ToolResult {
  if (!result.ok) {
    return { ...result } satisfies ToolError;
  }
  const existing = result as ToolOk;
  if (typeof existing.latency_ms === "number") {
    return existing;
  }
  return { ...existing, latency_ms: latencyMs } satisfies ToolOk;
}

export class McpAdapter {
  private readonly servers = new Map<string, McpServer>();
  private readonly recorded = new Map<string, RecordedPair[]>();
  private readonly mode: McpMode;

  constructor(private readonly options: McpAdapterOptions) {
    this.mode = options.mode ?? "live";
    if (this.mode === "replay" && Array.isArray(options.recordedEvents)) {
      this.ingestRecordedEvents(options.recordedEvents);
    }
  }

  registerServer(server: McpServer): void {
    this.servers.set(server.id, server);
  }

  async call(
    serverId: string,
    tool: string,
    args: unknown,
    options: McpCallOptions = {},
  ): Promise<ToolResult> {
    const argsHash = hashArgs(args);
    const spanId = options.spanId ?? randomUUID();

    if (this.mode === "replay") {
      return this.replayCall(serverId, tool, argsHash, spanId, options);
    }

    const argsPreview = buildArgsPreview(args);
    const callEnvelope: EventEnvelope<McpCallEventData> = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      type: "mcp.call",
      version: 1,
      trace_id: this.options.traceId,
      span_id: spanId,
      parent_span_id: options.parentSpanId,
      topic: options.topic,
      data: {
        server: serverId,
        tool,
        args_hash: argsHash,
        ...(argsPreview ? { args_preview: argsPreview } : {}),
      },
    };

    await this.options.bus.publish(callEnvelope);

    const server = this.servers.get(serverId);
    if (!server) {
      const error: ToolError = {
        ok: false,
        code: "mcp.server_not_found",
        message: `server ${serverId} is not registered`,
      };
      await this.publishResultEnvelope(spanId, serverId, tool, argsHash, error, options);
      return error;
    }

    const started = Date.now();
    let invocationResult: ToolResult;
    try {
      invocationResult = await server.invoke(tool, args);
    } catch (err: any) {
      const message = err instanceof Error ? err.message : "unexpected mcp invocation error";
      invocationResult = { ok: false, code: "mcp.invoke_error", message } satisfies ToolError;
    }
    const latency = Date.now() - started;
    const merged = mergeLatency(invocationResult, latency);

    await this.publishResultEnvelope(spanId, serverId, tool, argsHash, merged, options);
    return merged;
  }

  private async replayCall(
    serverId: string,
    tool: string,
    argsHash: string,
    spanId: string,
    options: McpCallOptions,
  ): Promise<ToolResult> {
    const key = this.buildKey(serverId, tool, argsHash);
    const queue = this.recorded.get(key);
    if (!queue || queue.length === 0) {
      return {
        ok: false,
        code: "mcp.replay_missing_result",
        message: "no recorded result available for the given call",
      } satisfies ToolError;
    }

    const pair = queue.shift()!;
    const callEnvelope = cloneEnvelope(pair.call);
    callEnvelope.span_id = callEnvelope.span_id ?? spanId;
    await this.options.bus.publish(callEnvelope);

    const resultEnvelope = cloneEnvelope(pair.result);
    resultEnvelope.span_id = resultEnvelope.span_id ?? spanId;
    await this.options.bus.publish(resultEnvelope);

    if (pair.result.data.ok) {
      const okData = pair.result.data;
      const toolOk: ToolOk = {
        ok: true,
        data: okData.result,
        latency_ms: okData.latency_ms,
        cost: okData.cost,
      } satisfies ToolOk;
      return toolOk;
    }

    const errorData = pair.result.data;
    return {
      ok: false,
      code: errorData.error?.code ?? "mcp.replay_error",
      message: errorData.error?.message ?? "recorded call failed",
      ...(errorData.error?.retryable != null ? { retryable: errorData.error.retryable } : {}),
    } satisfies ToolError;
  }

  private async publishResultEnvelope(
    spanId: string,
    serverId: string,
    tool: string,
    argsHash: string,
    result: ToolResult,
    options: McpCallOptions,
  ): Promise<void> {
    const error = extractToolError(result);
    const resultEnvelope: EventEnvelope<McpResultEventData> = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      type: "mcp.result",
      version: 1,
      trace_id: this.options.traceId,
      span_id: spanId,
      parent_span_id: options.parentSpanId,
      topic: options.topic,
      data: {
        server: serverId,
        tool,
        args_hash: argsHash,
        ok: result.ok,
        ...(result.ok
          ? {
              result: result.data,
              latency_ms: (result as ToolOk).latency_ms,
              cost: (result as ToolOk).cost,
            }
          : {
              error: {
                code: error?.code ?? "mcp.error",
                message: error?.message ?? "unknown error",
                ...(error?.retryable != null ? { retryable: error.retryable } : {}),
              },
            }),
      },
    };

    await this.options.bus.publish(resultEnvelope);
  }

  private ingestRecordedEvents(events: EventEnvelope[]): void {
    const callBySpan = new Map<string, EventEnvelope<McpCallEventData>>();
    for (const event of events) {
      if (event.type === "mcp.call") {
        if (event.span_id) {
          callBySpan.set(event.span_id, event as EventEnvelope<McpCallEventData>);
        }
      }
    }

    for (const event of events) {
      if (event.type !== "mcp.result") continue;
      const resultEvent = event as EventEnvelope<McpResultEventData>;
      const data = resultEvent.data;
      const key = this.buildKey(data.server, data.tool, data.args_hash);
      const spanId = resultEvent.span_id;
      const callEvent =
        (spanId ? callBySpan.get(spanId) : undefined) ?? this.createSyntheticCall(resultEvent);
      const queue = this.recorded.get(key) ?? [];
      queue.push({ call: callEvent, result: resultEvent });
      this.recorded.set(key, queue);
    }
  }

  private createSyntheticCall(
    resultEvent: EventEnvelope<McpResultEventData>,
  ): EventEnvelope<McpCallEventData> {
    return {
      id: randomUUID(),
      ts: resultEvent.ts,
      type: "mcp.call",
      version: resultEvent.version,
      trace_id: resultEvent.trace_id,
      span_id: resultEvent.span_id,
      parent_span_id: resultEvent.parent_span_id,
      topic: resultEvent.topic,
      data: {
        server: resultEvent.data.server,
        tool: resultEvent.data.tool,
        args_hash: resultEvent.data.args_hash,
      },
    };
  }

  private buildKey(server: string, tool: string, argsHash: string): string {
    return `${server}::${tool}::${argsHash}`;
  }
}

export function createMcpAdapter(
  options: McpAdapterOptions & { core?: McpCoreServerOptions },
): McpAdapter {
  const adapter = new McpAdapter(options);
  const coreServer = new McpCoreServer(options.core);
  adapter.registerServer(coreServer);
  return adapter;
}

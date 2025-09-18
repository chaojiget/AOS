import { createHash, randomUUID } from "node:crypto";

import type { ToolCall, ToolContext, ToolError, ToolOk, ToolResult } from "../core/agent";
import type { EventBus, EventEnvelope } from "../runtime/events";
import { createCoreMcpServer, type McpCoreServerOptions } from "../servers/mcp-core";

export type McpMode = "record" | "replay";

export interface CreateMcpRegistryOptions {
  workspaceRoot?: string;
  eventBus?: EventBus;
  mode?: McpMode;
  replayState?: Map<string, ToolResult>;
}

interface RegisteredTool {
  serverId: string;
  handler: (args: any, ctx: ToolContext) => Promise<ToolResult>;
}

function cloneResult<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildReplayKey(serverId: string, toolName: string, args: unknown): string {
  return JSON.stringify({ server: serverId, tool: toolName, args });
}

function publishEvent(bus: EventBus | undefined, envelope: EventEnvelope): Promise<EventEnvelope | void> {
  if (!bus) {
    return Promise.resolve();
  }
  const enriched: EventEnvelope = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    version: 1,
    ...envelope,
  };
  return bus.publish(enriched);
}

function cloneToolResult(result: ToolResult): ToolResult {
  return cloneResult(result);
}

export interface McpRegistry {
  hasTool(name: string): boolean;
  invoke(call: ToolCall, ctx: ToolContext): Promise<ToolResult | null>;
}

export function createMcpRegistry(options: CreateMcpRegistryOptions = {}): McpRegistry {
  const server = createCoreMcpServer({ root: options.workspaceRoot });
  const tools = new Map<string, RegisteredTool>();
  const servers = [server];
  for (const srv of servers) {
    for (const [name, handler] of Object.entries(srv.tools)) {
      tools.set(name, { serverId: srv.id, handler });
    }
  }

  const mode: McpMode = options.mode ?? "record";
  const replayState = options.replayState ?? new Map<string, ToolResult>();

  return {
    hasTool(name: string): boolean {
      return tools.has(name);
    },

    async invoke(call: ToolCall, ctx: ToolContext): Promise<ToolResult | null> {
      const entry = tools.get(call.name);
      if (!entry) {
        return null;
      }

      const args = call.args ?? {};
      const key = buildReplayKey(entry.serverId, call.name, args);

      await publishEvent(options.eventBus, {
        type: "mcp.call",
        trace_id: ctx.trace_id,
        span_id: ctx.span_id,
        data: {
          server: entry.serverId,
          tool: call.name,
          args,
        },
      });

      if (mode === "replay") {
        const recorded = replayState.get(key);
        if (!recorded) {
          const error: ToolError = {
            ok: false,
            code: "mcp.replay_missing",
            message: `no recorded result for ${call.name}`,
          };
          await publishEvent(options.eventBus, {
            type: "mcp.result",
            trace_id: ctx.trace_id,
            span_id: ctx.span_id,
            data: {
              server: entry.serverId,
              tool: call.name,
              ok: false,
              error: error.message,
            },
          });
          return error;
        }
        const cloned = cloneToolResult(recorded);
        await publishEvent(options.eventBus, {
          type: "mcp.result",
          trace_id: ctx.trace_id,
          span_id: ctx.span_id,
          data: {
            server: entry.serverId,
            tool: call.name,
            ok: cloned.ok,
            bytes:
              cloned.ok && typeof (cloned.data as any)?.bytes === "number"
                ? (cloned.data as any).bytes
                : undefined,
            path:
              cloned.ok && typeof (cloned.data as any)?.path === "string"
                ? (cloned.data as any).path
                : undefined,
            result: cloned,
          },
        });
        return cloneResult(cloned);
      }

      const result = await entry.handler(args, ctx);
      replayState.set(key, cloneToolResult(result));
      await publishEvent(options.eventBus, {
        type: "mcp.result",
        trace_id: ctx.trace_id,
        span_id: ctx.span_id,
        data: {
          server: entry.serverId,
          tool: call.name,
          ok: result.ok,
          bytes:
            result.ok && typeof (result.data as any)?.bytes === "number"
              ? (result.data as any).bytes
              : undefined,
          path:
            result.ok && typeof (result.data as any)?.path === "string"
              ? (result.data as any).path
              : undefined,
          result,
        },
      });
      return result;
    },
  } satisfies McpRegistry;
}

// ---------------------------------------------------------------------------
// MCP Adapter (event stream oriented API)
// ---------------------------------------------------------------------------

export type McpAdapterMode = "live" | "replay";

export interface McpAdapterOptions {
  traceId: string;
  bus: EventBus;
  mode?: McpAdapterMode;
  recordedEvents?: EventEnvelope[];
  core?: McpCoreServerOptions;
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

type RecordedPair = {
  call: EventEnvelope<McpCallEventData>;
  result: EventEnvelope<McpResultEventData>;
};

interface McpServer {
  id: string;
  invoke(tool: string, args: unknown, ctx: ToolContext): Promise<ToolResult>;
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
  if (args == null) {
    return undefined;
  }
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
  if (result.ok) {
    return null;
  }
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

function createCoreServerForAdapter(options: McpCoreServerOptions = {}): McpServer {
  const resolved: McpCoreServerOptions = {
    root: options.root ?? (options as any)?.workspaceRoot,
  };
  const definition = createCoreMcpServer(resolved);
  return {
    id: definition.id,
    async invoke(tool: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
      const handler = definition.tools[tool];
      if (!handler) {
        return {
          ok: false,
          code: "mcp.tool_not_found",
          message: `tool ${tool} is not available on server ${definition.id}`,
        } satisfies ToolError;
      }
      return handler(args, ctx);
    },
  } satisfies McpServer;
}

export class McpAdapter {
  private readonly servers = new Map<string, McpServer>();
  private readonly recorded = new Map<string, RecordedPair[]>();
  private readonly mode: McpAdapterMode;

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
      invocationResult = await server.invoke(tool, args, {
        trace_id: this.options.traceId,
        span_id: spanId,
        parent_span_id: options.parentSpanId,
      });
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
      return {
        ok: true,
        data: okData.result,
        latency_ms: okData.latency_ms,
        cost: okData.cost,
      } satisfies ToolOk;
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
    const envelope: EventEnvelope<McpResultEventData> = {
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
              result: (result as ToolOk).data,
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

    await this.options.bus.publish(envelope);
  }

  private ingestRecordedEvents(events: EventEnvelope[]): void {
    const callBySpan = new Map<string, EventEnvelope<McpCallEventData>>();
    for (const event of events) {
      if (event.type === "mcp.call" && event.span_id) {
        callBySpan.set(event.span_id, event as EventEnvelope<McpCallEventData>);
      }
    }

    for (const event of events) {
      if (event.type !== "mcp.result") {
        continue;
      }
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

export function createMcpAdapter(options: McpAdapterOptions): McpAdapter {
  const adapter = new McpAdapter(options);
  const coreServer = createCoreServerForAdapter(options.core);
  adapter.registerServer(coreServer);
  return adapter;
}

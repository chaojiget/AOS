import { randomUUID } from "node:crypto";

import type { ToolCall, ToolContext, ToolError, ToolResult } from "../core/agent";
import type { EventBus, EventEnvelope } from "../runtime/events";
import { createCoreMcpServer } from "../servers/mcp-core";

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
            bytes: cloned.ok && typeof (cloned.data as any)?.bytes === "number" ? (cloned.data as any).bytes : undefined,
            path: cloned.ok && typeof (cloned.data as any)?.path === "string" ? (cloned.data as any).path : undefined,
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
          bytes: result.ok && typeof (result.data as any)?.bytes === "number" ? (result.data as any).bytes : undefined,
          path: result.ok && typeof (result.data as any)?.path === "string" ? (result.data as any).path : undefined,
          result,
        },
      });
      return result;
    },
  } satisfies McpRegistry;
}

import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createDefaultToolInvoker } from "../adapters/core";
import { createMcpAdapter } from "../adapters/mcp";
import type {
  ActionOutcome,
  AgentKernel,
  Plan,
  PlanStep,
  ReviewResult,
  ToolInvoker,
  ToolResult,
} from "../core/agent";
import { runLoop, type CoreEvent, type EmitSpanOptions } from "../core/agent";
import { EventBus, wrapCoreEvent, type EventEnvelope } from "../runtime/events";
import { EpisodeLogger } from "../runtime/episode";
import { replayEpisode } from "../runtime/replay";

class WorkspaceKernel implements AgentKernel {
  private planned = false;

  constructor(
    private readonly toolInvoker: ToolInvoker,
    private readonly traceId: string,
  ) {}

  async perceive(): Promise<void> {
    // no-op
  }

  async plan(): Promise<Plan> {
    if (this.planned) {
      return { steps: [] } satisfies Plan;
    }
    this.planned = true;
    return {
      steps: [
        {
          id: "write-note",
          op: "file.write",
          args: { path: "notes/hello.txt", content: "hello workspace" },
        },
        {
          id: "read-note",
          op: "file.read",
          args: { path: "notes/hello.txt" },
        },
        {
          id: "list-notes",
          op: "file.list",
          args: { path: "notes" },
        },
      ],
    } satisfies Plan;
  }

  async act(step: PlanStep): Promise<ActionOutcome> {
    const result = await this.toolInvoker(
      { name: step.op, args: step.args },
      { trace_id: this.traceId, span_id: step.id },
    );
    return { step, result } satisfies ActionOutcome;
  }

  async review(actions: ActionOutcome[]): Promise<ReviewResult> {
    return { score: actions.length, passed: true, notes: ["workspace"] } satisfies ReviewResult;
  }

  async renderFinal(actions: ActionOutcome[]): Promise<any> {
    return actions.map((action) => (action.result.ok ? action.result.data : action.result));
  }
}

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

describe("mcp workspace registry", () => {
  it("records workspace operations and replays results", async () => {
    const workspaceRoot = await createTempDir("aos-workspace-");
    const episodesDir = await createTempDir("aos-episodes-");
    const traceId = randomUUID();

    const bus = new EventBus();
    const logger = new EpisodeLogger({ traceId, dir: episodesDir });
    const recordedEvents: EventEnvelope[] = [];
    bus.subscribe(async (event) => {
      recordedEvents.push(event);
      await logger.append(event);
    });

    const replayState = new Map<string, ToolResult>();

    try {
      const toolInvoker = createDefaultToolInvoker({
        workspaceRoot,
        eventBus: bus,
        replayState,
      });

      const kernel = new WorkspaceKernel(toolInvoker, traceId);
      const emit = async (event: CoreEvent, span?: EmitSpanOptions) => {
        await bus.publish(wrapCoreEvent(traceId, event, span));
      };
      const result = await runLoop(kernel, emit, { context: { traceId } });

      expect(result.reason).toBe("completed");
      expect(Array.isArray(result.final)).toBe(true);
      expect(result.final).toHaveLength(3);

      const writtenContent = await readFile(join(workspaceRoot, "notes/hello.txt"), "utf8");
      expect(writtenContent).toBe("hello workspace");

      const writeToolEvent = recordedEvents.find((event) => {
        if (event.type !== "tool.succeeded") return false;
        const data = event.data as any;
        return data?.type === "tool" && data?.name === "file.write";
      });
      expect(writeToolEvent).toBeTruthy();
      const writeResult = (writeToolEvent?.data as any)?.result as ToolResult | undefined;
      expect(writeResult?.ok).toBe(true);
      if (writeResult?.ok) {
        expect(typeof (writeResult.data as any)?.bytes).toBe("number");
        expect((writeResult.data as any).bytes > 0).toBe(true);
      }

      const mcpResultEvent = recordedEvents.find(
        (event) => event.type === "mcp.result" && (event.data as any).tool === "file.write",
      );
      expect(mcpResultEvent).toBeTruthy();
      expect((mcpResultEvent?.data as any).bytes > 0).toBe(true);
      expect((mcpResultEvent?.data as any).path).toBe("notes/hello.txt");

      const replayed = await replayEpisode(traceId, { dir: episodesDir });
      expect(replayed.map((event) => event.type)).toEqual(
        recordedEvents.map((event) => event.type),
      );
      const replayWriteResult = replayed.find(
        (event) => event.type === "mcp.result" && (event.data as any).tool === "file.write",
      );
      expect(replayWriteResult?.data).toMatchObject(mcpResultEvent?.data ?? {});

      const replayWorkspaceRoot = await createTempDir("aos-replay-workspace-");
      const replayBus = new EventBus();
      const replayLogger = new EpisodeLogger({ traceId: `${traceId}-replay`, dir: episodesDir });
      replayBus.subscribe(async (event) => {
        await replayLogger.append(event);
      });

      try {
        const replayInvoker = createDefaultToolInvoker({
          workspaceRoot: replayWorkspaceRoot,
          eventBus: replayBus,
          mode: "replay",
          replayState,
        });

        const replayKernel = new WorkspaceKernel(replayInvoker, `${traceId}-replay`);
        const replayEmit = async (event: CoreEvent, span?: EmitSpanOptions) => {
          await replayBus.publish(wrapCoreEvent(`${traceId}-replay`, event, span));
        };
        const replayResult = await runLoop(replayKernel, replayEmit, {
          context: { traceId: `${traceId}-replay` },
        });

        expect(replayResult.final).toEqual(result.final);

        const replayFiles = await readdir(replayWorkspaceRoot);
        expect(replayFiles.length).toBe(0);
      } finally {
        await rm(replayWorkspaceRoot, { recursive: true, force: true });
      }
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
      await rm(episodesDir, { recursive: true, force: true });
    }
  });
});

describe("mcp workspace adapter", () => {
  it("records events, applies file side effects, and replays deterministically", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "mcp-workspace-"));
    const traceId = "trace-mcp-workspace";
    const events: EventEnvelope[] = [];
    const bus = new EventBus();
    bus.subscribe(async (event) => {
      events.push(event);
    });

    const adapter = createMcpAdapter({ traceId, bus, core: { root: workspace } });

    const writeArgs = { path: "notes/hello.txt", content: "hello mcp" } as const;
    const writeResult = await adapter.call("mcp-core", "file.write", writeArgs);
    if (!writeResult.ok) {
      throw new Error(`expected write to succeed, received error: ${writeResult.code}`);
    }
    expect(writeResult.data.path).toBe("notes/hello.txt");
    expect(writeResult.data.bytes).toBe(Buffer.byteLength(writeArgs.content, "utf8"));

    const readResult = await adapter.call("mcp-core", "file.read", { path: writeArgs.path });
    if (!readResult.ok) {
      throw new Error(`expected read to succeed, received error: ${readResult.code}`);
    }
    expect(readResult.data.path).toBe("notes/hello.txt");
    expect(readResult.data.content).toBe(writeArgs.content);

    const listResult = await adapter.call("mcp-core", "file.list", { path: "notes" });
    if (!listResult.ok) {
      throw new Error(`expected list to succeed, received error: ${listResult.code}`);
    }
    expect(listResult.data.path).toBe("notes");
    const entries = (listResult.data as { entries: Array<{ name: string }> }).entries;
    const entryNames = entries.map((entry) => entry.name);
    expect(entryNames).toContain("hello.txt");

    const fileContent = await readFile(join(workspace, "notes", "hello.txt"), "utf8");
    expect(fileContent).toBe(writeArgs.content);

    const callEvents = events.filter((event) => event.type === "mcp.call");
    const resultEvents = events.filter((event) => event.type === "mcp.result");
    expect(callEvents).toHaveLength(3);
    expect(resultEvents).toHaveLength(3);

    const spanMatches = new Map<string, { call: EventEnvelope; result?: EventEnvelope }>();
    for (const event of callEvents) {
      if (event.span_id) {
        spanMatches.set(event.span_id, { call: event });
      }
    }
    for (const event of resultEvents) {
      if (!event.span_id) continue;
      const pair = spanMatches.get(event.span_id);
      expect(pair).toBeDefined();
      if (pair) {
        pair.result = event;
        const callData = pair.call.data as { args_hash: string };
        const resultData = event.data as { args_hash: string; ok: boolean };
        expect(resultData.args_hash).toBe(callData.args_hash);
        expect(typeof resultData.ok).toBe("boolean");
      }
    }

    await rm(join(workspace, "notes"), { recursive: true, force: true });

    const replayBus = new EventBus();
    const replayEvents: EventEnvelope[] = [];
    replayBus.subscribe(async (event) => {
      replayEvents.push(event);
    });

    const replayAdapter = createMcpAdapter({
      traceId,
      bus: replayBus,
      mode: "replay",
      recordedEvents: events,
      core: { root: workspace },
    });

    const replayWrite = await replayAdapter.call("mcp-core", "file.write", writeArgs);
    expect(replayWrite).toMatchObject({ ok: true, data: writeResult.data });

    const replayRead = await replayAdapter.call("mcp-core", "file.read", { path: writeArgs.path });
    expect(replayRead).toMatchObject({ ok: true, data: readResult.data });

    const replayList = await replayAdapter.call("mcp-core", "file.list", { path: "notes" });
    expect(replayList).toMatchObject({ ok: true, data: listResult.data });

    expect(replayEvents.filter((event) => event.type === "mcp.call")).toHaveLength(3);
    expect(replayEvents.filter((event) => event.type === "mcp.result")).toHaveLength(3);

    await expect(stat(join(workspace, "notes", "hello.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

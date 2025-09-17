import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createDefaultToolInvoker } from "../adapters/core";
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

  constructor(private readonly toolInvoker: ToolInvoker, private readonly traceId: string) {}

  async perceive(): Promise<void> {
    /* no-op */
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

describe("mcp workspace server", () => {
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
      const emit = (event: CoreEvent, span?: EmitSpanOptions) =>
        bus.publish(wrapCoreEvent(traceId, event, span));
      const result = await runLoop(kernel, emit, { context: { traceId } });

      expect(result.reason).toBe("completed");
      expect(Array.isArray(result.final)).toBe(true);
      expect(result.final).toHaveLength(3);

      const writtenContent = await readFile(join(workspaceRoot, "notes/hello.txt"), "utf8");
      expect(writtenContent).toBe("hello workspace");

      const writeToolEvent = recordedEvents.find((event) => {
        if (event.type !== "agent.tool") return false;
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
        const replayEmit = (event: CoreEvent, span?: EmitSpanOptions) =>
          replayBus.publish(wrapCoreEvent(`${traceId}-replay`, event, span));
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


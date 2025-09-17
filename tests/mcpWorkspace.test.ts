import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMcpAdapter } from "../adapters/mcp";
import type { ToolResult } from "../core/agent";
import { EventBus, type EventEnvelope } from "../runtime/events";

function assertOk(result: ToolResult): asserts result is Extract<ToolResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`expected ok result, received error ${result.code}: ${result.message}`);
  }
}

describe("mcp workspace integration", () => {
  it("records events, applies file side effects, and replays deterministically", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "mcp-workspace-"));
    const traceId = "trace-mcp-workspace";
    const events: EventEnvelope[] = [];
    const bus = new EventBus();
    bus.subscribe(async (event) => {
      events.push(event);
    });

    const adapter = createMcpAdapter({ traceId, bus, core: { workspaceRoot: workspace } });

    const writeArgs = { path: "notes/hello.txt", content: "hello mcp" } as const;
    const writeResult = await adapter.call("mcp-core", "file.write", writeArgs);
    assertOk(writeResult);
    expect(writeResult.data.path).toBe("notes/hello.txt");
    expect(writeResult.data.bytes).toBe(Buffer.byteLength(writeArgs.content, "utf8"));

    const readResult = await adapter.call("mcp-core", "file.read", { path: writeArgs.path });
    assertOk(readResult);
    expect(readResult.data.path).toBe("notes/hello.txt");
    expect(readResult.data.content).toBe(writeArgs.content);

    const listResult = await adapter.call("mcp-core", "file.list", { path: "notes" });
    assertOk(listResult);
    expect(listResult.data.path).toBe("notes");
    const entries = (listResult.data as { entries: Array<{ name: string }> }).entries;
    const entryNames = entries.map((entry) => entry.name);
    expect(entryNames).toContainEqual("hello.txt");

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
      if (!pair) {
        throw new Error(`missing call event for span ${event.span_id}`);
      }
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
      core: { workspaceRoot: workspace },
    });

    const replayWrite = await replayAdapter.call("mcp-core", "file.write", writeArgs);
    expect(replayWrite.ok).toBe(true);
    if (replayWrite.ok) {
      expect(replayWrite.data).toEqual(writeResult.data);
    }

    const replayRead = await replayAdapter.call("mcp-core", "file.read", { path: writeArgs.path });
    expect(replayRead.ok).toBe(true);
    if (replayRead.ok) {
      expect(replayRead.data).toEqual(readResult.data);
    }

    const replayList = await replayAdapter.call("mcp-core", "file.list", { path: "notes" });
    expect(replayList.ok).toBe(true);
    if (replayList.ok) {
      expect(replayList.data).toEqual(listResult.data);
    }

    expect(replayEvents.filter((event) => event.type === "mcp.call")).toHaveLength(3);
    expect(replayEvents.filter((event) => event.type === "mcp.result")).toHaveLength(3);

    try {
      await stat(join(workspace, "notes", "hello.txt"));
      throw new Error("expected stat to fail for missing file");
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
    }
  });
});

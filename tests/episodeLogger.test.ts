import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EpisodeLogger, readEpisodeIndex } from "../runtime/episode";
import type { EventEnvelope } from "../runtime/events";

describe("EpisodeLogger", () => {
  it("appends events with monotonic line numbers and byte offsets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "episode-"));
    const logger = new EpisodeLogger({ traceId: "trace-123", dir });

    let counter = 0;
    const makeEvent = (type: string, data: Record<string, unknown>): EventEnvelope => ({
      id: `${type}-${counter++}`,
      ts: new Date(Date.UTC(2024, 0, 1)).toISOString(),
      type,
      version: 1,
      trace_id: "trace-123",
      data,
    });

    const first = await logger.append(makeEvent("agent.plan", { revision: 1 }));
    const second = await logger.append(makeEvent("agent.final", { final: { answer: "done" } }));

    expect(first.ln).toBe(1);
    expect(first.byte_offset).toBe(0);
    expect(second.ln).toBe(2);
    expect(typeof second.byte_offset).toBe("number");
    expect((second.byte_offset ?? 0) > (first.byte_offset ?? -1)).toBe(true);

    const filePath = join(dir, "trace-123.jsonl");
    const text = await readFile(filePath, "utf8");
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(2);

    const parsedSecond = JSON.parse(lines[1]) as EventEnvelope;
    expect(parsedSecond.byte_offset).toBe(second.byte_offset);
    expect(parsedSecond.ln).toBe(2);

    const indexEntries = await readEpisodeIndex("trace-123", dir);
    expect(indexEntries).toHaveLength(2);
    expect(indexEntries[0].ln).toBe(1);
    expect(indexEntries[1].byte_offset).toBe(second.byte_offset);
  });
});

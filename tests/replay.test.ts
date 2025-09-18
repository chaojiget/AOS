import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EpisodeLogger } from "../runtime/episode";
import { replayEpisode } from "../runtime/replay";
import type { EventEnvelope } from "../runtime/events";

describe("replayEpisode", () => {
  let counter = 0;
  const createEvent = (
    traceId: string,
    type: string,
    data: Record<string, unknown>,
  ): EventEnvelope => ({
    id: `${type}-${counter++}`,
    ts: new Date(Date.UTC(2024, 0, 1)).toISOString(),
    type,
    version: 1,
    trace_id: traceId,
    data,
  });

  it("streams events in the order they were recorded", async () => {
    const dir = await mkdtemp(join(tmpdir(), "replay-"));
    const traceId = "trace-replay";
    const logger = new EpisodeLogger({ traceId, dir });

    const first = await logger.append(createEvent(traceId, "run.progress", { step: "act" }));
    const second = await logger.append(
      createEvent(traceId, "run.finished", { outputs: { answer: 42 }, reason: "completed" }),
    );

    const seen: string[] = [];
    const events = await replayEpisode(traceId, {
      dir,
      onEvent: (event) => {
        seen.push(event.type);
      },
    });

    expect(events).toHaveLength(2);
    expect(events[0].ln).toBe(first.ln);
    expect(events[1].ln).toBe(second.ln);
    expect(seen).toEqual(["run.progress", "run.finished"]);
  });

  it("throws when the episode file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "missing-"));
    let caught = false;
    try {
      await replayEpisode("missing-trace", { dir });
    } catch (error: unknown) {
      caught = /episode not found/i.test(String(error));
    }
    expect(caught).toBe(true);
  });
});

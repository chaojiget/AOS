import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { importTsModule } from "./helpers/loadTsModule.js";

const { EpisodeLogger } = await importTsModule("../runtime/episode.ts", import.meta.url);
const { replayEpisode } = await importTsModule("../runtime/replay.ts", import.meta.url);

let counter = 0;
function createEvent(traceId, type, data = {}) {
  counter += 1;
  return {
    id: `evt-${counter}`,
    ts: new Date(Date.UTC(2024, 0, 1, 0, 0, counter)).toISOString(),
    type,
    version: 1,
    trace_id: traceId,
    data,
  };
}

describe("Replay", () => {
  it("streams events in the order they were recorded", async () => {
    const dir = await mkdtemp(join(tmpdir(), "replay-"));
    const traceId = "trace-replay";
    const logger = new EpisodeLogger({ traceId, dir });
    const first = await logger.append(createEvent(traceId, "agent.progress", { step: "act" }));
    const second = await logger.append(
      createEvent(traceId, "agent.final", { outputs: { answer: 42 } }),
    );

    const seenTypes = [];
    const events = await replayEpisode(traceId, {
      dir,
      onEvent: (event) => {
        seenTypes.push(event.type);
      },
    });

    expect(events).toHaveLength(2);
    expect(events[0].ln).toBe(first.ln);
    expect(events[1].ln).toBe(second.ln);
    expect(seenTypes).toEqual(["agent.progress", "agent.final"]);
  });

  it("returns parsed events without an onEvent handler", async () => {
    const dir = await mkdtemp(join(tmpdir(), "replay-no-handler-"));
    const traceId = "trace-no-handler";
    const logger = new EpisodeLogger({ traceId, dir });
    await logger.append(createEvent(traceId, "agent.plan", { steps: [] }));
    await logger.append(createEvent(traceId, "agent.log", { message: "done" }));

    const events = await replayEpisode(traceId, { dir });
    expect(events.map((event) => event.type)).toEqual(["agent.plan", "agent.log"]);
  });
});

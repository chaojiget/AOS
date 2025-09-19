import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EpisodeLogger } from "../runtime/episode";
import { replayEpisode } from "../runtime/replay";
import { wrapCoreEvent, type EventEnvelope } from "../runtime/events";
import type { CoreEvent } from "../core/agent";

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
    const alert = await logger.append(
      createEvent(traceId, "guardian.alert", {
        reason: "step-limit",
        limit: 1,
        metrics: { stepCount: 1, totalLatencyMs: 100, totalCost: 0.5 },
      }),
    );
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

    expect(events).toHaveLength(3);
    expect(events[0].ln).toBe(first.ln);
    expect(events[1].ln).toBe(alert.ln);
    expect(events[2].ln).toBe(second.ln);
    expect(seen).toEqual(["run.progress", "guardian.alert", "run.finished"]);
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

describe("event mapping", () => {
  it("wraps terminated core events as run.terminated envelopes", () => {
    const event: CoreEvent = {
      type: "terminated",
      reason: "cost-limit",
      context: {
        reason: "cost-limit",
        limit: 10,
        metrics: { stepCount: 3, totalLatencyMs: 120, totalCost: 11 },
      },
    };

    const envelope = wrapCoreEvent("trace-wrap", event);
    expect(envelope.type).toBe("run.terminated");
    const data = envelope.data as CoreEvent;
    expect(data.type).toBe("terminated");
    expect((data as any).context.limit).toBe(10);
  });
});

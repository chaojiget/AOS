import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestApp, type TestAppContext } from "./support/testApp";
import { AgentController } from "../../servers/api/src/agent/agent.controller";

interface EpisodesControllerContract {
  listEpisodes(): Promise<any>;
  getEpisode(traceId: string): Promise<any>;
  replayEpisode(traceId: string, payload: any): Promise<any>;
}

describe("Episodes API (stage three contract)", () => {
  let context: TestAppContext;
  let agentController: AgentController;
  let episodesController: EpisodesControllerContract | undefined;
  let runId: string;

  beforeEach(async () => {
    context = await createTestApp();
    agentController = context.moduleRef.get(AgentController);
    try {
      episodesController = context.moduleRef.get<EpisodesControllerContract>(
        "EpisodesController" as any,
        { strict: false },
      );
    } catch (error) {
      episodesController = undefined;
    }

    const start = await agentController.startRun({ message: "episode" });
    runId = start.runId;
  });

  afterEach(async () => {
    await context.cleanup();
  });

  it("lists recorded episodes with metadata", async () => {
    expect(episodesController).toBeTruthy();
    const response = await episodesController!.listEpisodes();

    expect(response.code).toBe("OK");
    const items = response.data?.items ?? [];
    const match = items.find((item: any) => item.trace_id === runId);
    expect(match).toBeTruthy();
    expect(match.status).toBe("completed");
    expect(typeof match.started_at).toBe("string");
  });

  it("returns episode detail and events", async () => {
    expect(episodesController).toBeTruthy();
    const response = await episodesController!.getEpisode(runId);

    expect(response.code).toBe("OK");
    expect(response.data.trace_id).toBe(runId);
    expect(Array.isArray(response.data.events)).toBe(true);
    expect(response.data.events.length > 0).toBe(true);

    const episodesFile = join(context.episodesDir, `${runId}.jsonl`);
    const fileContents = await readFile(episodesFile, "utf8");
    expect(fileContents.length > 0).toBe(true);
  });

  it("replays an episode and reports score drift", async () => {
    expect(episodesController).toBeTruthy();
    const response = await episodesController!.replayEpisode(runId, {
      mode: "deterministic",
      seed: 42,
    });

    expect(response.code).toBe("OK");
    expect(response.data.trace_id).toBe(runId);
    expect(Object.prototype.hasOwnProperty.call(response.data, "score_before")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(response.data, "score_after")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(response.data, "diff")).toBe(true);
  });
});

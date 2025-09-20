import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestApp, type TestAppContext } from "./support/testApp";
import { AgentController } from "../../servers/api/src/agent/agent.controller";
import { RunsController } from "../../servers/api/src/runs/runs.controller";

function collectEventTypes(events: any[]): string[] {
  return events.map((event) => event.type);
}

async function waitForRunStatus(
  controller: RunsController,
  runId: string,
  expected: string,
  timeoutMs = 2000,
) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const summary = await controller.getRun(runId);
    if (summary.status === expected) {
      return summary;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`run ${runId} did not reach ${expected} within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("Agent run lifecycle", () => {
  let context: TestAppContext;
  let agentController: AgentController;
  let runsController: RunsController;

  beforeEach(async () => {
    context = await createTestApp();
    agentController = context.moduleRef.get(AgentController);
    runsController = context.moduleRef.get(RunsController);
  });

  afterEach(async () => {
    await context.cleanup();
  });

  it("starts a run, persists summary and exposes events", async () => {
    const startResponse = await agentController.startRun({ message: "hello" });
    const runId = startResponse.runId;

    const summary = await waitForRunStatus(runsController, runId, "completed");
    expect(summary.id).toBe(runId);
    expect((summary.finalResult?.message ?? "").startsWith("echoed:")).toBe(true);

    const eventsResponse = await runsController.getRunEvents(runId);
    const eventTypes = collectEventTypes(eventsResponse.events);
    expect(eventTypes.includes("run.started")).toBe(true);
    expect(eventTypes.includes("plan.updated")).toBe(true);
    expect(eventTypes.includes("tool.succeeded")).toBe(true);
    expect(eventTypes.includes("final.answer")).toBe(true);
  });

  it("filters events using the since query parameter", async () => {
    const startResponse = await agentController.startRun({ message: "filter" });
    const runId = startResponse.runId;
    await waitForRunStatus(runsController, runId, "completed");

    const allEvents = await runsController.getRunEvents(runId);
    const events = allEvents.events;
    expect(events.length > 3).toBe(true);

    const midpoint = Math.floor(events.length / 2);
    const cutoff = new Date(events[midpoint].ts).toISOString();

    const filtered = await runsController.getRunEvents(runId, cutoff);
    expect(filtered.events.length < events.length).toBe(true);
    expect(filtered.events.every((event) => event.ts >= cutoff)).toBe(true);
  });
});

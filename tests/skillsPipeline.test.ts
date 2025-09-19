import { describe, expect, it } from "vitest";

import {
  HeuristicSkillSummariser,
  InMemoryEventsRepository,
  InMemorySkillsRepository,
  SkillAnalysisPipeline,
  type ToolCallEvent,
} from "../packages/skills/pipeline";
import type { SkillRecord } from "../packages/skills/storage";

describe("SkillAnalysisPipeline", () => {
  const baseEvents: ToolCallEvent[] = [
    {
      id: "evt-1",
      traceId: "trace-1",
      toolName: "csv.clean",
      timestamp: "2024-01-01T00:00:00.000Z",
      callId: "call-1",
      success: true,
      input: { path: "data.csv" },
      output: { rows: 10 },
      tags: ["csv"],
    },
    {
      id: "evt-1-dup",
      traceId: "trace-1",
      toolName: "csv.clean",
      timestamp: "2024-01-01T00:00:01.000Z",
      callId: "call-1",
      success: true,
      input: { path: "data.csv" },
      output: { rows: 10 },
      tags: ["csv"],
    },
    {
      id: "evt-2",
      traceId: "trace-2",
      toolName: "csv.clean",
      timestamp: "2024-01-01T00:02:00.000Z",
      callId: "call-2",
      success: false,
      input: { path: "dirty.csv" },
      output: { error: "bad format" },
      tags: ["csv"],
    },
    {
      id: "evt-3",
      traceId: "trace-3",
      toolName: "stats.aggregate",
      timestamp: "2024-01-01T00:05:00.000Z",
      callId: "call-3",
      success: true,
      input: { numbers: [1, 2, 3] },
      output: { mean: 2 },
      tags: ["stats"],
    },
  ];

  it("aggregates tool events and generates candidate skills", async () => {
    const eventsRepo = new InMemoryEventsRepository(baseEvents);
    const skillsRepo = new InMemorySkillsRepository([]);
    const summariser = new HeuristicSkillSummariser();
    const pipeline = new SkillAnalysisPipeline(eventsRepo, skillsRepo, summariser, {
      minSamplesForReview: 2,
      clock: () => new Date("2024-01-02T00:00:00.000Z"),
    });

    const result = await pipeline.run();

    expect(result.analyzedEvents).toBe(3); // duplicate call should be ignored
    expect(result.aggregated).toHaveLength(2);

    const csvSkill = result.updatedSkills.find((skill) => skill.id === "csv.clean");
    expect(csvSkill).toBeDefined();
    expect(csvSkill?.used_count).toBe(2);
    expect(csvSkill?.win_rate).toBe(0.5);
    expect(csvSkill?.review_status).toBe("pending_review");
    expect(csvSkill?.last_analyzed_at).toBe("2024-01-02T00:00:00.000Z");

    const analysis = (csvSkill?.template_json as any)?.analysis;
    expect(Array.isArray(analysis?.event_ids)).toBe(true);
    expect(analysis.event_ids).toContain("call-1");
    expect(csvSkill?.tags).toContain("csv");

    const candidates = result.candidates.map((skill) => skill.id);
    expect(candidates).toContain("csv.clean");
    expect(candidates).toContain("stats.aggregate");
  });

  it("preserves manual review status for approved skills and increments metrics", async () => {
    const existingSkill: SkillRecord = {
      id: "csv.clean",
      name: "CSV Cleaner",
      description: "Existing skill",
      enabled: true,
      category: "data",
      tags: ["csv"],
      template_json: {
        analysis: {
          event_ids: ["call-1"],
          success_count: 1,
          failure_count: 0,
        },
      },
      used_count: 1,
      win_rate: 1,
      review_status: "approved",
      last_analyzed_at: "2024-01-01T00:00:00.000Z",
    };

    const eventsRepo = new InMemoryEventsRepository(baseEvents);
    const skillsRepo = new InMemorySkillsRepository([existingSkill]);
    const summariser = new HeuristicSkillSummariser();
    const pipeline = new SkillAnalysisPipeline(eventsRepo, skillsRepo, summariser, {
      minSamplesForReview: 2,
      clock: () => new Date("2024-01-03T00:00:00.000Z"),
    });

    const result = await pipeline.run();

    const csvSkill = result.updatedSkills.find((skill) => skill.id === "csv.clean");
    expect(csvSkill).toBeDefined();
    expect(csvSkill?.used_count).toBe(2);
    expect(csvSkill?.win_rate).toBe(0.5);
    expect(csvSkill?.review_status).toBe("approved");

    const analysis = (csvSkill?.template_json as any)?.analysis;
    expect(analysis.success_count).toBe(1);
    expect(analysis.failure_count).toBe(1);
    expect(analysis.event_ids).toContain("call-2");
  });
});

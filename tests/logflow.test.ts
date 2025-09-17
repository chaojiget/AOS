import { describe, expect, it } from "vitest";
import { buildBranchTree } from "../lib/logflow";
import type { LogFlowMessage } from "../types/logflow";

describe("logflow branch tree", () => {
  it("constructs branch tree from span relationships", () => {
    const messages: LogFlowMessage[] = [
      {
        id: "evt-1",
        ln: 1,
        span_id: "trace-root",
        type: "agent.progress",
        ts: new Date().toISOString(),
        message: "root progress",
        data: { step: "perceive" },
      },
      {
        id: "evt-2",
        ln: 2,
        span_id: "plan-1",
        parent_span_id: "trace-root",
        type: "agent.plan",
        ts: new Date().toISOString(),
        message: "plan",
        data: { revision: 1 },
      },
      {
        id: "evt-3",
        ln: 3,
        span_id: "step-a",
        parent_span_id: "plan-1",
        type: "agent.progress",
        ts: new Date().toISOString(),
        message: "progress",
        data: { step: "act" },
      },
      {
        id: "evt-4",
        ln: 4,
        span_id: "step-a",
        parent_span_id: "plan-1",
        type: "agent.tool",
        ts: new Date().toISOString(),
        message: "tool",
        data: { name: "tool.echo" },
      },
      {
        id: "evt-5",
        ln: 5,
        span_id: "step-b",
        parent_span_id: "plan-1",
        type: "agent.tool",
        ts: new Date().toISOString(),
        message: "tool",
        data: { name: "tool.calc" },
      },
    ];

    const tree = buildBranchTree(messages, "plan-1");

    expect(tree).not.toEqual(null);
    expect(tree?.span_id).toBe("plan-1");
    expect(tree?.children.map((child) => child.span_id)).toEqual(["step-a", "step-b"]);
    const stepANode = tree?.children.find((child) => child.span_id === "step-a");
    expect(stepANode?.events).toHaveLength(2);
    expect(stepANode?.events.map((evt) => evt.type)).toEqual([
      "agent.progress",
      "agent.tool",
    ]);
  });
});

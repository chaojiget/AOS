import { describe, expect, it } from "vitest";
import { buildBranchTree } from "../lib/logflow";
import type { BranchNode, LogFlowMessage } from "../types/logflow";

describe("buildBranchTree", () => {
  const baseMessage = {
    type: "agent.tool",
    ts: "2024-01-01T00:00:00.000Z",
    message: "",
    data: {},
  } as const;

  it("creates a hierarchical tree for plan and step spans", () => {
    const messages: LogFlowMessage[] = [
      {
        id: "1",
        ln: 1,
        span_id: "plan-1-1",
        parent_span_id: undefined,
        ...baseMessage,
      },
      {
        id: "2",
        ln: 2,
        span_id: "step-a",
        parent_span_id: "plan-1-1",
        ...baseMessage,
      },
      {
        id: "3",
        ln: 3,
        span_id: "step-b",
        parent_span_id: "plan-1-1",
        ...baseMessage,
      },
      {
        id: "4",
        ln: 4,
        span_id: "tool-a",
        parent_span_id: "step-a",
        ...baseMessage,
      },
    ];

    const tree = buildBranchTree(messages, "plan-1-1") as BranchNode;
    expect(tree.span_id).toBe("plan-1-1");
    expect(tree.children).toHaveLength(2);
    const [stepA, stepB] = tree.children;
    expect(stepA.span_id).toBe("step-a");
    expect(stepA.parent_span_id).toBe("plan-1-1");
    expect(stepA.children).toHaveLength(1);
    expect(stepA.children[0]?.span_id).toBe("tool-a");
    expect(stepB.span_id).toBe("step-b");
    expect(tree.first_ln).toBe(1);
    expect(tree.last_ln).toBe(4);
  });

  it("creates placeholder nodes when parent spans are missing events", () => {
    const messages: LogFlowMessage[] = [
      {
        id: "child",
        ln: 10,
        span_id: "child-span",
        parent_span_id: "missing-parent",
        ...baseMessage,
      },
    ];

    const tree = buildBranchTree(messages, "missing-parent") as BranchNode;
    expect(tree.span_id).toBe("missing-parent");
    expect(tree.events).toHaveLength(0);
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]?.span_id).toBe("child-span");
    expect(tree.first_ln).toBe(10);
    expect(tree.last_ln).toBe(10);
  });

  it("groups events under their respective span nodes", () => {
    const now = new Date().toISOString();
    const messages: LogFlowMessage[] = [
      {
        id: "evt-1",
        ln: 1,
        span_id: "trace-root",
        type: "agent.progress",
        ts: now,
        message: "root progress",
        data: { step: "perceive" },
      },
      {
        id: "evt-2",
        ln: 2,
        span_id: "plan-1",
        parent_span_id: "trace-root",
        type: "agent.plan",
        ts: now,
        message: "plan",
        data: { revision: 1 },
      },
      {
        id: "evt-3",
        ln: 3,
        span_id: "step-a",
        parent_span_id: "plan-1",
        type: "agent.progress",
        ts: now,
        message: "progress",
        data: { step: "act" },
      },
      {
        id: "evt-4",
        ln: 4,
        span_id: "step-a",
        parent_span_id: "plan-1",
        type: "agent.tool",
        ts: now,
        message: "tool",
        data: { name: "tool.echo" },
      },
      {
        id: "evt-5",
        ln: 5,
        span_id: "step-b",
        parent_span_id: "plan-1",
        type: "agent.tool",
        ts: now,
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
    expect(stepANode?.events.map((evt) => evt.type)).toEqual(["agent.progress", "agent.tool"]);
  });
});

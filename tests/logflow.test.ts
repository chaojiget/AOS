import { describe, it, expect } from "vitest";
import type { BranchNode, LogFlowMessage } from "../types/logflow";
import { buildBranchTree } from "../lib/logflow";

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
});

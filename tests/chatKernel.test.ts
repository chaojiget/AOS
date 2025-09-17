import { describe, it, expect } from "vitest";
import { createChatKernel } from "../adapters/core";
import type { ToolInvoker } from "../core/agent";
import type { ChatMessage } from "../types/chat";

describe("createChatKernel", () => {
  it("appends the current user message to history when planning", async () => {
    const history: ChatMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];
    const toolInvoker: ToolInvoker = async () => ({ ok: true, data: {} });
    const kernel = createChatKernel({
      message: "How are you?",
      history,
      traceId: "trace-123",
      toolInvoker,
    });

    await kernel.perceive({ traceId: "trace-123" });
    const plan = await kernel.plan();
    expect(plan).toBeTruthy();
    if (!plan) {
      throw new Error("plan should not be null");
    }
    expect(plan.steps).toHaveLength(1);
    const [step] = plan.steps;
    expect(step.op).toBe("llm.chat");
    expect(step.args).toMatchObject({
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
        { role: "user", content: "How are you?" },
      ],
    });
  });
});

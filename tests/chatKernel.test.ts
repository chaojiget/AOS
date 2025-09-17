import { describe, expect, it } from "vitest";
import { createChatKernel } from "../adapters/core";
import type { ToolInvoker } from "../core/agent";

describe("createChatKernel", () => {
  it("includes history messages when planning and acting", async () => {
    const invocations: any[] = [];
    const toolInvoker: ToolInvoker = async (call) => {
      invocations.push(call);
      return { ok: true, data: { content: "ack" } };
    };

    const history = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ];

    const kernel = createChatKernel({
      message: "what's next?",
      traceId: "trace-test",
      toolInvoker,
      history,
    });

    await kernel.perceive({ traceId: "trace-test" });
    const plan = await kernel.plan();
    expect(Boolean(plan)).toBe(true);

    const nonNullPlan = plan!;
    expect(nonNullPlan.steps).toHaveLength(1);

    const step = nonNullPlan.steps[0];
    expect(step.args).toEqual({
      messages: [...history, { role: "user", content: "what's next?" }],
    });

    const outcome = await kernel.act(step);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      name: "llm.chat",
      args: step.args,
    });
    expect(outcome.result.ok).toBe(true);
  });
});

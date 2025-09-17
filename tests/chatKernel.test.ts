import { describe, expect, it } from "vitest";
import { DEFAULT_SYSTEM_PROMPT, createChatKernel } from "../adapters/core";
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
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.name).toBe("llm.chat");
    expect(invocations[0]?.args?.messages?.[0]).toEqual(DEFAULT_SYSTEM_PROMPT);
    expect(Boolean(plan)).toBe(true);

    const nonNullPlan = plan!;
    expect(nonNullPlan.steps).toHaveLength(1);

    const step = nonNullPlan.steps[0];
    expect(step.args).toEqual({
      messages: [
        DEFAULT_SYSTEM_PROMPT,
        ...history,
        { role: "user", content: "what's next?" },
      ],
    });

    const outcome = await kernel.act(step);
    expect(invocations).toHaveLength(2);
    expect(invocations[1]).toMatchObject({
      name: "llm.chat",
      args: step.args,
    });
    expect(outcome.result.ok).toBe(true);
  });
  it("does not duplicate the system prompt when planning multiple times", async () => {
    const toolInvoker: ToolInvoker = async () => ({
      ok: true,
      data: { content: "ack" },
    });

    const kernel = createChatKernel({
      message: "第一轮", 
      traceId: "trace-dup", 
      toolInvoker,
    });

    await kernel.perceive({ traceId: "trace-dup" });
    const firstPlan = await kernel.plan();
    const secondPlan = await kernel.plan();

    const extractMessages = (plan: any) => plan.steps[0]?.args?.messages ?? [];

    const firstMessages = extractMessages(firstPlan);
    const secondMessages = extractMessages(secondPlan);

    expect(firstMessages.filter((msg: any) => msg.role === "system")).toHaveLength(1);
    expect(secondMessages.filter((msg: any) => msg.role === "system")).toHaveLength(1);
    expect(firstMessages[0]).toEqual(DEFAULT_SYSTEM_PROMPT);
    expect(secondMessages[0]).toEqual(DEFAULT_SYSTEM_PROMPT);
  });
});

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
    if (!plan) {
      throw new Error("expected plan to be generated");
    }

    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.name).toBe("llm.chat");
    const plannerMessages = invocations[0]?.args?.messages ?? [];
    expect(plannerMessages[0]).toEqual(DEFAULT_SYSTEM_PROMPT);
    const finalPrompt = plannerMessages.at(-1);
    expect(finalPrompt?.role).toBe("user");
    expect(String(finalPrompt?.content)).toContain("what's next?");
    expect(String(finalPrompt?.content)).toContain("结构化的执行计划");

    const step = plan.steps[0];
    expect(step.args).toEqual({
      messages: [DEFAULT_SYSTEM_PROMPT, ...history, { role: "user", content: "what's next?" }],
    });

    const outcome = await kernel.act(step);
    expect(invocations).toHaveLength(2);
    expect(invocations[1]).toMatchObject({ name: "llm.chat", args: step.args });
    expect(outcome.result.ok).toBe(true);
  });

  it("falls back to llm.chat when planning fails", async () => {
    const invocations: any[] = [];
    const toolInvoker: ToolInvoker = async (call) => {
      invocations.push(call);
      if (call.name === "llm.chat" && invocations.length === 1) {
        return { ok: false, code: "llm.mock_error", message: "no plan" };
      }
      return { ok: true, data: { content: "fallback" } };
    };

    const kernel = createChatKernel({
      message: "fallback please",
      traceId: "trace-fallback",
      toolInvoker,
    });

    await kernel.perceive({ traceId: "trace-fallback" });
    const plan = await kernel.plan();
    if (!plan) {
      throw new Error("expected fallback plan");
    }

    expect(plan.reason).toBe("fallback");
    expect(plan.steps).toHaveLength(1);
    const step = plan.steps[0];
    expect(step.op).toBe("llm.chat");
    expect(step.args.messages[0]).toEqual(DEFAULT_SYSTEM_PROMPT);
    expect(plan.notes?.some((note) => note.includes("no plan"))).toBe(true);

    const outcome = await kernel.act(step);
    expect(outcome.result.ok).toBe(true);
    expect(invocations).toHaveLength(2);
    expect(invocations[1]).toMatchObject({ name: "llm.chat" });
  });

  it("does not duplicate the system prompt when planning multiple times", async () => {
    const toolInvoker: ToolInvoker = async () => ({ ok: true, data: { content: "ack" } });

    const kernel = createChatKernel({
      message: "第一轮",
      traceId: "trace-dup",
      toolInvoker,
    });

    await kernel.perceive({ traceId: "trace-dup" });
    const firstPlan = await kernel.plan();
    if (!firstPlan) {
      throw new Error("expected first plan");
    }
    const secondPlan = await kernel.plan();
    if (!secondPlan) {
      throw new Error("expected second plan");
    }

    const extractMessages = (plan: any) => plan.steps[0]?.args?.messages ?? [];

    const firstMessages = extractMessages(firstPlan);
    const secondMessages = extractMessages(secondPlan);

    expect(firstMessages.filter((msg: any) => msg.role === "system")).toHaveLength(1);
    expect(secondMessages.filter((msg: any) => msg.role === "system")).toHaveLength(1);
    expect(firstMessages[0]).toEqual(DEFAULT_SYSTEM_PROMPT);
    expect(secondMessages[0]).toEqual(DEFAULT_SYSTEM_PROMPT);
  });
});

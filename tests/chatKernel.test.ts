import { describe, expect, it } from "vitest";
import { DEFAULT_SYSTEM_PROMPT, createChatKernel } from "../adapters/core";
import type { ToolInvoker } from "../core/agent";

describe("createChatKernel", () => {
  it("requests planner plan and normalises llm step arguments", async () => {
    const invocations: any[] = [];
    const toolInvoker: ToolInvoker = async (call) => {
      invocations.push(call);
      if (call.name === "planner.plan") {
        return {
          ok: true,
          data: {
            steps: [
              {
                id: "provided-id",
                op: "llm.chat",
                args: {},
                description: "final answer",
              },
            ],
          },
        };
      }
      if (call.name === "llm.chat") {
        return { ok: true, data: { content: "ack" } };
      }
      throw new Error(`unexpected call ${call.name}`);
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

    expect(invocations[0]).toMatchObject({
      name: "planner.plan",
      args: {
        goal: "what's next?",
        history: [
          DEFAULT_SYSTEM_PROMPT,
          ...history,
          { role: "user", content: "what's next?" },
        ],
        revision: 1,
      },
    });

    expect(plan.steps).toHaveLength(1);
    const step = plan.steps[0];
    expect(step.id).toBe("provided-id");
    expect(step.op).toBe("llm.chat");
    expect(step.args.messages).toEqual(invocations[0].args.history);
    expect(step.description).toBe("final answer");

    const outcome = await kernel.act(step);
    expect(invocations[1]).toMatchObject({
      name: "llm.chat",
      args: step.args,
    });
    expect(outcome.result.ok).toBe(true);
  });

  it("falls back to llm.chat when planner fails", async () => {
    const invocations: any[] = [];
    const toolInvoker: ToolInvoker = async (call) => {
      invocations.push(call);
      if (call.name === "planner.plan") {
        return { ok: false, code: "planner.error", message: "no plan" };
      }
      if (call.name === "llm.chat") {
        return { ok: true, data: { content: "fallback" } };
      }
      throw new Error(`unexpected call ${call.name}`);
    };

    const kernel = createChatKernel({
      message: "fallback please",
      traceId: "trace-fallback",
      toolInvoker,
    });

    await kernel.perceive({ traceId: "trace-fallback" });
    const plan = await kernel.plan();

    expect(plan.reason).toBe("fallback");
    expect((plan.notes ?? []).some((note) => note.includes("planner failed"))).toBe(true);
    expect(plan.steps).toHaveLength(1);
    const step = plan.steps[0];
    expect(step.op).toBe("llm.chat");
    expect(step.args.messages[0]).toEqual(DEFAULT_SYSTEM_PROMPT);
    expect(step.id.includes("-r1-")).toBe(true);

    const outcome = await kernel.act(step);
    expect(outcome.result.ok).toBe(true);
    expect(invocations[1]).toMatchObject({ name: "llm.chat" });
  });

  it("does not duplicate the system prompt when planning multiple times", async () => {
    const toolInvoker: ToolInvoker = async (call) => {
      if (call.name === "planner.plan") {
        return {
          ok: true,
          data: {
            steps: [
              {
                op: "llm.chat",
                args: {},
              },
            ],
          },
        };
      }
      return { ok: true, data: { content: "ack" } };
    };

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

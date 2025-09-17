import { describe, expect, it } from "vitest";
import { createChatKernel } from "../adapters/core";
import type { ToolInvoker } from "../core/agent";
import {
  runLoop,
  type AgentKernel,
  type Plan,
  type PlanStep,
  type ActionOutcome,
  type ToolResult,
  type CoreEvent,
  type EmitSpanOptions,
} from "../core/agent";

type EmittedEntry = { event: CoreEvent; span?: EmitSpanOptions };

type FinalEventEntry = {
  event: Extract<CoreEvent, { type: "final" }>;
  span?: EmitSpanOptions;
};

function isFinalEvent(entry: EmittedEntry): entry is FinalEventEntry {
  return entry.event.type === "final";
}

describe("runLoop", () => {
  it("executes plan steps and resolves when review passes", async () => {
    const emitted: EmittedEntry[] = [];
    const kernel: AgentKernel = {
      async perceive() {
        /* no-op */
      },
      async plan(): Promise<Plan> {
        return {
          steps: [
            { id: "s1", op: "tool.echo", args: { value: "hi" } },
            { id: "s2", op: "tool.echo", args: { value: "there" } },
          ],
        };
      },
      async act(step) {
        const result: ToolResult<string> = { ok: true, data: step.args.value.toUpperCase() };
        return { step, result } as ActionOutcome<string>;
      },
      async review(actions) {
        return { score: actions.length, passed: true, notes: ["ok"] };
      },
      async renderFinal(outputs) {
        return outputs
          .map((item) => (item.result.ok ? item.result.data : ""))
          .filter((value) => Boolean(value))
          .join(" ");
      },
    };

    const result = await runLoop(
      kernel,
      (event: CoreEvent, span?: EmitSpanOptions) => {
        emitted.push({ event, span });
      },
      { maxIterations: 3, context: { traceId: "trace-run-loop", input: "hi" } },
    );

    expect(result.reason).toBe("completed");
    expect(result.final).toBe("HI THERE");
    expect(emitted.some((item) => item.event.type === "plan")).toBeTruthy();
    const planEvent = emitted.find((item) => item.event.type === "plan");
    expect(planEvent?.span?.spanId).toBe("plan-1");
    expect(planEvent?.span?.parentSpanId).toBe("trace-run-loop");

    const toolEvents = emitted.filter(
      (item): item is { event: Extract<CoreEvent, { type: "tool" }>; span?: EmitSpanOptions } =>
        item.event.type === "tool",
    );
    expect(toolEvents).toHaveLength(2);
    expect(toolEvents.map((item) => item.span?.spanId)).toEqual(["s1", "s2"]);
    expect(toolEvents.every((item) => item.span?.parentSpanId === "plan-1")).toBe(true);
    expect(toolEvents.some((item) => item.event.name === "tool.echo")).toBeTruthy();

    const finalEvent = emitted.find(isFinalEvent);
    expect(finalEvent?.event.reason).toBe("completed");
    expect(finalEvent?.span?.spanId).toBe("trace-run-loop");
  });

  it("falls back to final output when no plan is produced", async () => {
    const emitted: EmittedEntry[] = [];
    const kernel: AgentKernel = {
      async perceive() {
        /* no-op */
      },
      async plan(): Promise<Plan> {
        return { steps: [] };
      },
      async act(step) {
        const result: ToolResult = { ok: true, data: { fallback: true, reason: step.args.reason } };
        return { step, result } as ActionOutcome;
      },
      async review() {
        return { score: 0, passed: false, notes: ["no steps"] };
      },
      async renderFinal(outputs) {
        return outputs.map((item) => (item.result.ok ? item.result.data : item.result));
      },
    };

    const result = await runLoop(
      kernel,
      (event: CoreEvent, span?: EmitSpanOptions) => {
        emitted.push({ event, span });
      },
      { context: { traceId: "trace-fallback", input: "hello" } },
    );

    expect(result.reason).toBe("no-plan");
    expect(result.final).toEqual([{ fallback: true, reason: undefined }]);

    const finalEvent = emitted.find(isFinalEvent);
    expect(finalEvent?.event.reason).toBe("no-plan");
    expect(finalEvent?.span?.spanId).toBe("trace-fallback");

    const planEvent = emitted.find((item) => item.event.type === "plan");
    expect(planEvent?.span?.spanId).toBe("plan-1");

    const toolEvent = emitted.find(
      (item): item is { event: Extract<CoreEvent, { type: "tool" }>; span?: EmitSpanOptions } =>
        item.event.type === "tool",
    );
    expect(toolEvent?.event.name).toBe("llm.chat");
    expect(toolEvent?.span).toEqual({ spanId: "fallback-1", parentSpanId: "plan-1" });
  });

  it("propagates ask span ids when kernel requests clarification", async () => {
    const emitted: EmittedEntry[] = [];
    const kernel: AgentKernel = {
      async perceive() {
        /* noop */
      },
      async plan(): Promise<Plan> {
        return {
          steps: [{ id: "ask-step", op: "tool.ask", args: { question: "?" } }],
        };
      },
      async act(step) {
        const ask = { question: "Need more info", origin_step: step.id };
        return { step, result: { ok: true, data: null }, ask } as ActionOutcome;
      },
      async review() {
        return { score: 0, passed: false };
      },
      async renderFinal() {
        return null;
      },
    };

    const result = await runLoop(
      kernel,
      (event: CoreEvent, span?: EmitSpanOptions) => {
        emitted.push({ event, span });
      },
      { context: { traceId: "trace-ask" } },
    );

    expect(result.reason).toBe("ask");
    const askEvent = emitted.find((item) => item.event.type === "ask");
    expect(askEvent?.span).toEqual({ spanId: "ask-step", parentSpanId: "plan-1" });
  });

  it("terminates when a tool returns a non-retryable error", async () => {
    const emitted: EmittedEntry[] = [];
    const actCalls: PlanStep[] = [];
    const act = async (step: PlanStep): Promise<ActionOutcome> => {
      actCalls.push(step);
      if (step.id === "s1") {
        return {
          step,
          result: { ok: false, code: "fatal", message: "boom", retryable: false },
        } satisfies ActionOutcome;
      }
      return {
        step,
        result: { ok: true, data: "should-not-run" },
      } satisfies ActionOutcome;
    };

    let renderFinalCalls = 0;
    const renderFinal = async () => {
      renderFinalCalls += 1;
      return { text: "failed" };
    };
    let reviewCalled = false;
    const review = async () => {
      reviewCalled = true;
      return { score: 0, passed: false };
    };

    const kernel: AgentKernel = {
      async perceive() {
        /* no-op */
      },
      async plan(): Promise<Plan> {
        return {
          steps: [
            { id: "s1", op: "tool.fail", args: {} },
            { id: "s2", op: "tool.next", args: {} },
          ],
        } satisfies Plan;
      },
      act: act as AgentKernel["act"],
      review: review as AgentKernel["review"],
      renderFinal: renderFinal as AgentKernel["renderFinal"],
    };

    const result = await runLoop(
      kernel,
      (event: CoreEvent, span?: EmitSpanOptions) => {
        emitted.push({ event, span });
      },
      { context: { traceId: "trace-non-retry" } },
    );

    expect(result.reason).toBe("non-retryable-error");
    expect(renderFinalCalls).toBe(1);
    expect(reviewCalled).toBe(false);
    expect(actCalls).toHaveLength(1);

    const toolEvents = emitted.filter(
      (item): item is { event: Extract<CoreEvent, { type: "tool" }>; span?: EmitSpanOptions } =>
        item.event.type === "tool",
    );
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0]?.event.result?.ok).toBe(false);

    const planEvents = emitted.filter((item) => item.event.type === "plan");
    expect(planEvents).toHaveLength(1);

    const finalEvent = emitted.find(isFinalEvent);
    expect(finalEvent?.event.reason).toBe("non-retryable-error");
  });

  it("runs chat kernel multi-step plan to completion", async () => {
    const emitted: EmittedEntry[] = [];
    const plannerCalls: string[] = [];
    const toolInvoker: ToolInvoker = async (call) => {
      if (call.name === "planner.plan") {
        plannerCalls.push(call.name);
        return {
          ok: true,
          data: {
            notes: ["multi-step"],
            steps: [
              {
                id: "fetch-1",
                op: "http.get",
                args: { url: "https://example.com" },
                description: "fetch data",
              },
              {
                id: "reply-1",
                op: "llm.chat",
                args: {},
                description: "produce answer",
              },
            ],
          },
        } satisfies ToolResult;
      }
      if (call.name === "http.get") {
        return { ok: true, data: { body: "hello world" } } satisfies ToolResult;
      }
      if (call.name === "llm.chat") {
        return { ok: true, data: { content: "完成了" } } satisfies ToolResult;
      }
      throw new Error(`unexpected call ${call.name}`);
    };

    const kernel = createChatKernel({
      message: "请总结",
      traceId: "trace-multi",
      toolInvoker,
    });

    const result = await runLoop(
      kernel,
      (event: CoreEvent, span?: EmitSpanOptions) => {
        emitted.push({ event, span });
      },
      { context: { traceId: "trace-multi" }, maxIterations: 2 },
    );

    expect(plannerCalls).toHaveLength(1);
    expect(result.reason).toBe("completed");
    expect(result.review?.passed).toBe(true);
    expect(result.review?.score).toBe(1);
    expect(result.final).toEqual({ text: "完成了", raw: { content: "完成了" } });

    const planEvent = emitted.find((entry) => entry.event.type === "plan");
    expect(planEvent?.event.steps).toHaveLength(2);
  });

  it("stops with ask when planner requests clarification", async () => {
    const emitted: EmittedEntry[] = [];
    const toolInvoker: ToolInvoker = async (call) => {
      if (call.name === "planner.plan") {
        return {
          ok: true,
          data: {
            steps: [
              {
                id: "ask-more",
                op: "ask.user",
                args: { question: "需要更多细节" },
              },
            ],
          },
        } satisfies ToolResult;
      }
      throw new Error(`unexpected call ${call.name}`);
    };

    const kernel = createChatKernel({
      message: "请帮忙",
      traceId: "trace-ask-planner",
      toolInvoker,
    });

    const result = await runLoop(
      kernel,
      (event: CoreEvent, span?: EmitSpanOptions) => {
        emitted.push({ event, span });
      },
      { context: { traceId: "trace-ask-planner" } },
    );

    expect(result.reason).toBe("ask");
    expect(result.actions[0]?.ask?.question).toBe("需要更多细节");
    const askEvent = emitted.find((entry) => entry.event.type === "ask");
    expect(askEvent?.event.question).toBe("需要更多细节");
  });

  it("retries after a failure and succeeds on the next plan", async () => {
    const emitted: EmittedEntry[] = [];
    let plannerCalls = 0;
    let llmCalls = 0;
    const toolInvoker: ToolInvoker = async (call) => {
      if (call.name === "planner.plan") {
        plannerCalls += 1;
        return {
          ok: true,
          data: {
            reason: plannerCalls === 1 ? "initial" : "retry",
            steps: [
              {
                id: `reply-${plannerCalls}`,
                op: "llm.chat",
                args: {},
              },
            ],
          },
        } satisfies ToolResult;
      }
      if (call.name === "llm.chat") {
        llmCalls += 1;
        if (llmCalls === 1) {
          return {
            ok: false,
            code: "llm.error",
            message: "temporary failure",
            retryable: true,
          } satisfies ToolResult;
        }
        return { ok: true, data: { content: "恢复成功" } } satisfies ToolResult;
      }
      throw new Error(`unexpected call ${call.name}`);
    };

    const kernel = createChatKernel({
      message: "请回答",
      traceId: "trace-retry",
      toolInvoker,
    });

    const result = await runLoop(
      kernel,
      (event: CoreEvent, span?: EmitSpanOptions) => {
        emitted.push({ event, span });
      },
      { context: { traceId: "trace-retry" }, maxIterations: 3 },
    );

    expect(plannerCalls).toBe(2);
    expect(llmCalls).toBe(2);
    expect(result.reason).toBe("completed");
    expect(result.review?.passed).toBe(true);
    expect(result.review?.notes?.some((note) => note.includes("历史失败步骤"))).toBe(true);
    expect(result.actions).toHaveLength(2);
  });
});

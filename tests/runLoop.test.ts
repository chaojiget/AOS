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

function isPlanEvent(
  entry: EmittedEntry,
): entry is { event: Extract<CoreEvent, { type: "plan" }>; span?: EmitSpanOptions } {
  return entry.event.type === "plan";
}

function isAskEvent(
  entry: EmittedEntry,
): entry is { event: Extract<CoreEvent, { type: "ask" }>; span?: EmitSpanOptions } {
  return entry.event.type === "ask";
}

function isReflectNoteEvent(
  entry: EmittedEntry,
): entry is { event: Extract<CoreEvent, { type: "reflect.note" }>; span?: EmitSpanOptions } {
  return entry.event.type === "reflect.note";
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
    const planEvent = emitted.find(isPlanEvent);
    expect(planEvent?.span?.spanId).toBe("plan-1");
    expect(planEvent?.span?.parentSpanId).toBe("trace-run-loop");

    const toolEvents = emitted.filter(
      (item): item is { event: Extract<CoreEvent, { type: "tool" }>; span?: EmitSpanOptions } =>
        item.event.type === "tool",
    );
    expect(toolEvents).toHaveLength(4);
    const startedTools = toolEvents.filter((item) => item.event.status === "started");
    expect(startedTools.map((item) => item.span?.spanId)).toEqual(["s1", "s2"]);
    const succeededTools = toolEvents.filter((item) => item.event.status === "succeeded");
    expect(succeededTools.map((item) => item.span?.spanId)).toEqual(["s1", "s2"]);
    expect(succeededTools.every((item) => item.event.result?.ok === true)).toBe(true);
    expect(toolEvents.every((item) => item.span?.parentSpanId === "plan-1")).toBe(true);
    expect(toolEvents.some((item) => item.event.name === "tool.echo")).toBeTruthy();

    const reflectNotes = emitted.filter(isReflectNoteEvent);
    expect(reflectNotes.map((item) => item.event.text)).toEqual(["ok"]);

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

    const planEvent = emitted.find(isPlanEvent);
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

  it("executes ChatKernel multi-step plan and stops when clarification is required", async () => {
    const emitted: EmittedEntry[] = [];
    const calls: Array<{ name: string; args: any }> = [];
    const planPayload = {
      reason: "analysis",
      notes: ["multi-step"],
      steps: [
        {
          id: "memory-1",
          op: "mcp-memory.get",
          args: { namespace: "default", key: "summary" },
          description: "读取缓存上下文",
        },
        {
          id: "clarify",
          op: "agent.ask",
          args: { question: "请提供目标文件路径" },
        },
        {
          id: "final-llm",
          op: "llm.chat",
          args: { prompt: "summarize" },
        },
      ],
    };

    let plannerCallCount = 0;
    const kernel = createChatKernel({
      message: "请概括文件并告诉我需要澄清什么",
      traceId: "trace-chat-kernel",
      toolInvoker: async (call) => {
        calls.push({ name: call.name, args: call.args });
        if (call.name === "llm.chat") {
          plannerCallCount += 1;
          if (plannerCallCount === 1) {
            return {
              ok: true,
              data: { content: JSON.stringify(planPayload) },
            } satisfies ToolResult;
          }
          return { ok: true, data: { content: "ignored" } } satisfies ToolResult;
        }
        if (call.name === "mcp.invoke") {
          return {
            ok: true,
            data: { server: call.args.server, tool: call.args.tool, value: "context" },
          } satisfies ToolResult;
        }
        return {
          ok: false,
          code: "unexpected",
          message: `unexpected tool: ${call.name}`,
        } satisfies ToolResult;
      },
    });

    const result = await runLoop(
      kernel,
      (event: CoreEvent, span?: EmitSpanOptions) => {
        emitted.push({ event, span });
      },
      { context: { traceId: "trace-chat-kernel", input: "概括一下" } },
    );

    expect(result.reason).toBe("ask");
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0]?.step.id).toBe("memory-1");
    expect(result.actions[0]?.result.ok).toBe(true);
    expect(result.actions[1]?.step.id).toBe("clarify");
    expect(result.actions[1]?.ask?.origin_step).toBe("clarify");
    expect(result.actions[1]?.ask?.question != null).toBe(true);
    expect((result.actions[1]?.ask?.question ?? "").includes("目标文件")).toBe(true);

    expect(calls[0]?.name).toBe("llm.chat");
    expect(calls[1]?.name).toBe("mcp.invoke");
    expect(calls[1]?.args).toMatchObject({
      server: "mcp-memory",
      tool: "get",
    });
    expect(calls[1]?.args?.params ?? calls[1]?.args?.input).toMatchObject({
      namespace: "default",
      key: "summary",
    });

    const askEvent = emitted.find((item) => item.event.type === "ask");
    expect(askEvent?.span).toEqual({ spanId: "clarify", parentSpanId: "plan-1" });
    expect(emitted.some((item) => item.event.type === "score")).toBe(false);
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
    expect(toolEvents).toHaveLength(2);
    const failedTool = toolEvents.find((item) => item.event.status === "failed");
    expect(failedTool?.event.result?.ok).toBe(false);

    const planEvents = emitted.filter((item) => item.event.type === "plan");
    expect(planEvents).toHaveLength(1);

    const finalEvent = emitted.find(isFinalEvent);
    expect(finalEvent?.event.reason).toBe("non-retryable-error");
  });

  it("runs chat kernel multi-step plan to completion", async () => {
    const emitted: EmittedEntry[] = [];
    let llmCalls = 0;
    const toolInvoker: ToolInvoker = async (call) => {
      if (call.name === "llm.chat") {
        llmCalls += 1;
        if (llmCalls === 1) {
          return {
            ok: true,
            data: {
              content: JSON.stringify({
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
              }),
            },
          } satisfies ToolResult;
        }
        return { ok: true, data: { content: "完成了" } } satisfies ToolResult;
      }
      if (call.name === "http.get") {
        return { ok: true, data: { body: "hello world" } } satisfies ToolResult;
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

    expect(llmCalls >= 2).toBe(true);
    expect(result.reason).toBe("completed");
    expect(result.review?.passed).toBe(true);
    expect(result.review?.score).toBe(1);
    expect(result.final).toEqual({ text: "完成了", raw: { content: "完成了" } });

    const planEvent = emitted.find(isPlanEvent);
    expect(planEvent?.event.steps).toHaveLength(2);
  });

  it("stops with ask when planner requests clarification", async () => {
    const emitted: EmittedEntry[] = [];
    const toolInvoker: ToolInvoker = async (call) => {
      if (call.name === "llm.chat") {
        return {
          ok: true,
          data: {
            content: JSON.stringify({
              steps: [
                {
                  id: "ask-more",
                  op: "ask.user",
                  args: { question: "需要更多细节" },
                },
              ],
            }),
          },
        } satisfies ToolResult;
      }
      return {
        ok: false,
        code: "unexpected",
        message: `unexpected call ${call.name}`,
      } satisfies ToolResult;
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
    const askEvent = emitted.find(isAskEvent);
    expect(askEvent?.event.question).toBe("需要更多细节");
  });

  it("retries after a failure and succeeds on the next plan", async () => {
    const emitted: EmittedEntry[] = [];
    let planAttempts = 0;
    let completionCalls = 0;
    const toolInvoker: ToolInvoker = async (call) => {
      if (call.name === "llm.chat") {
        if (Array.isArray(call.args?.messages)) {
          planAttempts += 1;
          const prompt = planAttempts === 1 ? "first attempt" : "second attempt";
          return {
            ok: true,
            data: {
              content: JSON.stringify({
                reason: planAttempts === 1 ? "initial" : "retry",
                steps: [
                  {
                    id: `reply-${planAttempts}`,
                    op: "llm.chat",
                    args: { prompt },
                  },
                ],
              }),
            },
          } satisfies ToolResult;
        }

        if (call.args?.prompt === "first attempt") {
          return {
            ok: false,
            code: "llm.error",
            message: "temporary failure",
            retryable: true,
          } satisfies ToolResult;
        }

        if (call.args?.prompt === "second attempt") {
          completionCalls += 1;
          return { ok: true, data: { content: "恢复成功" } } satisfies ToolResult;
        }
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

    expect(planAttempts).toBe(2);
    expect(completionCalls).toBe(1);
    expect(result.reason).toBe("completed");
    expect(result.review?.passed).toBe(true);
    expect(result.actions).toHaveLength(2);
  });
});

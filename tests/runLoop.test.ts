import { describe, it, expect } from "vitest";
import {
  runLoop,
  type AgentKernel,
  type Plan,
  type ActionOutcome,
  type ToolResult,
  type CoreEvent,
  type EmitSpanOptions,
} from "../core/agent";

describe("runLoop", () => {
  it("executes plan steps and resolves when review passes", async () => {
    const emitted: Array<{ event: CoreEvent; span?: EmitSpanOptions }> = [];
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
    expect(toolEvents.every((item) => item.span?.parentSpanId === "plan-1")).toBe(true);
    expect(toolEvents.map((item) => item.span?.spanId)).toEqual(["s1", "s2"]);
    expect(toolEvents.some((item) => item.event.name === "tool.echo")).toBeTruthy();
    const finalEvent = emitted.find(
      (item): item is { event: Extract<CoreEvent, { type: "final" }>; span?: EmitSpanOptions } =>
        item.event.type === "final",
    );
    expect(finalEvent?.event.reason).toBe("completed");
    expect(finalEvent?.span?.spanId).toBe("trace-run-loop");
  });

  it("falls back to final output when no plan is produced", async () => {
    const emitted: Array<{ event: CoreEvent; span?: EmitSpanOptions }> = [];
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
    const finalEvent = emitted.find(
      (item): item is { event: Extract<CoreEvent, { type: "final" }>; span?: EmitSpanOptions } =>
        item.event.type === "final",
    );
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
    const emitted: Array<{ event: CoreEvent; span?: EmitSpanOptions }> = [];
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
});

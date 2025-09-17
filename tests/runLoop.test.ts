import { describe, it, expect } from "vitest";
import {
  runLoop,
  type AgentKernel,
  type Plan,
  type ActionOutcome,
  type ToolResult,
  type CoreEvent,
} from "../core/agent";

describe("runLoop", () => {
  it("executes plan steps and resolves when review passes", async () => {
    const emitted: CoreEvent[] = [];
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
      (event: CoreEvent) => {
        emitted.push(event);
      },
      { maxIterations: 3 },
    );

    expect(result.reason).toBe("completed");
    expect(result.final).toBe("HI THERE");
    expect(emitted.some((event) => event.type === "plan")).toBeTruthy();
    expect(emitted.filter((event) => event.type === "tool")).toHaveLength(2);
    expect(
      emitted.some((event) => event.type === "tool" && event.name === "tool.echo"),
    ).toBeTruthy();
    const finalEvent = emitted.find((event) => event.type === "final");
    expect(finalEvent && finalEvent.reason).toBe("completed");
  });

  it("falls back to final output when no plan is produced", async () => {
    const emitted: CoreEvent[] = [];
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

    const result = await runLoop(kernel, (event: CoreEvent) => {
      emitted.push(event);
    });

    expect(result.reason).toBe("no-plan");
    expect(result.final).toEqual([{ fallback: true, reason: undefined }]);
    const finalEvent = emitted.find((event) => event.type === "final");
    expect(finalEvent && finalEvent.reason).toBe("no-plan");
    expect(
      emitted.some((event) => event.type === "tool" && event.name === "llm.chat"),
    ).toBeTruthy();
  });
});

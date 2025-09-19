import { randomUUID } from "node:crypto";

export type Step = "perceive" | "plan" | "act" | "review" | "final";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface PlanStep<TArgs = any> {
  id: string;
  op: string;
  args: TArgs;
  description?: string;
}

export interface Plan {
  steps: PlanStep[];
  revision?: number;
  reason?: string;
  notes?: string[];
}

export interface AskRequest {
  question: string;
  origin_step?: string;
  detail?: any;
}

export type ToolError = {
  ok: false;
  code: string;
  message: string;
  retryable?: boolean;
};

export type ToolOk<T = any> = {
  ok: true;
  data: T;
  latency_ms?: number;
  cost?: number;
};

export type ToolResult<T = any> = ToolOk<T> | ToolError;

export interface ToolCall<TArgs = any> {
  name: string;
  args: TArgs;
}

export interface ToolContext {
  trace_id: string;
  span_id?: string;
  parent_span_id?: string;
  metadata?: Record<string, any>;
}

export type ToolInvoker = (call: ToolCall, ctx: ToolContext) => Promise<ToolResult>;

export interface ActionOutcome<T = any> {
  step: PlanStep;
  result: ToolResult<T>;
  ask?: AskRequest;
  startedAt?: string;
  finishedAt?: string;
}

export interface ReviewResult {
  score: number;
  passed: boolean;
  notes?: string[];
}

export type CoreEvent =
  | { type: "progress"; step: Step; pct: number; note?: string }
  | { type: "plan"; steps: PlanStep[]; revision: number; reason?: string }
  | {
      type: "tool";
      name: string;
      args: any;
      result?: any;
      cost?: number;
      latency_ms?: number;
      status?: "started" | "succeeded" | "failed";
    }
  | { type: "reflect.note"; text: string; level?: LogLevel; origin_step?: string }
  | { type: "ask"; question: string; origin_step?: string }
  | { type: "score"; value: number; passed: boolean; notes?: string[] }
  | { type: "final"; outputs: any; reason?: string }
  | { type: "log"; level: LogLevel; message: string; detail?: any }
  | {
      type: "chat.msg";
      msg_id: string;
      role: string;
      text: string;
      trace_id: string;
      reply_to?: string;
    };

export interface EventMetadata {
  spanId?: string;
  parentSpanId?: string;
  topic?: string;
  level?: LogLevel;
}

export interface AgentContext {
  traceId: string;
  input?: any;
  metadata?: Record<string, any>;
}

export interface AgentKernel {
  perceive(ctx: AgentContext): Promise<void>;
  plan(): Promise<Plan | null>;
  act(step: PlanStep): Promise<ActionOutcome>;
  review(actions: ActionOutcome[]): Promise<ReviewResult>;
  renderFinal(actions: ActionOutcome[]): Promise<any>;
}

export interface RunLoopOptions {
  maxIterations?: number;
  context?: AgentContext;
}

export interface RunLoopResult {
  actions: ActionOutcome[];
  final?: any;
  reason: "completed" | "no-plan" | "ask" | "max-iterations" | "non-retryable-error";
  review?: ReviewResult;
}

const ensurePromise = async <T>(value: T | Promise<T>): Promise<T> => value;

export type EmitSpanOptions = EventMetadata;

export async function runLoop(
  kernel: AgentKernel,
  emit: (event: CoreEvent, span?: EmitSpanOptions) => void | Promise<void>,
  options: RunLoopOptions = {},
): Promise<RunLoopResult> {
  const maxIterations = options.maxIterations ?? 3;
  const actions: ActionOutcome[] = [];
  const context = options.context ?? { traceId: randomUUID() };
  const traceSpanId = context.traceId;

  await ensurePromise(kernel.perceive(context));
  await ensurePromise(
    emit({ type: "progress", step: "perceive", pct: 0.2 }, { spanId: traceSpanId }),
  );

  let iteration = 0;
  let lastReview: ReviewResult | undefined;

  while (iteration < maxIterations) {
    iteration += 1;
    const plan = await kernel.plan();
    const steps = plan?.steps ?? [];
    const revision = plan?.revision ?? iteration;
    const planSpanId = `plan-${revision}`;
    await ensurePromise(
      emit(
        {
          type: "plan",
          steps,
          revision,
          reason: plan?.reason ?? (iteration === 1 ? "initial" : "retry"),
        },
        { spanId: planSpanId, parentSpanId: traceSpanId },
      ),
    );

    if (!steps.length) {
      await ensurePromise(
        emit(
          {
            type: "log",
            level: "warn",
            message: "plan returned no executable steps, using fallback response",
          },
          { spanId: planSpanId, parentSpanId: traceSpanId },
        ),
      );

      const fallbackStep: PlanStep = {
        id: `fallback-${iteration}`,
        op: "llm.chat",
        args: { prompt: context.input ?? "" },
      };
      await ensurePromise(
        emit(
          {
            type: "tool",
            name: fallbackStep.op,
            args: fallbackStep.args,
            status: "started",
          },
          { spanId: fallbackStep.id, parentSpanId: planSpanId },
        ),
      );
      const outcome = await kernel.act(fallbackStep);
      actions.push(outcome);
      await ensurePromise(
        emit(
          {
            type: "tool",
            name: fallbackStep.op,
            args: fallbackStep.args,
            result: outcome.result,
            cost:
              "cost" in outcome.result && typeof (outcome.result as any).cost === "number"
                ? (outcome.result as any).cost
                : undefined,
            latency_ms:
              "latency_ms" in outcome.result &&
              typeof (outcome.result as any).latency_ms === "number"
                ? (outcome.result as any).latency_ms
                : undefined,
            status: outcome.result.ok ? "succeeded" : "failed",
          },
          { spanId: fallbackStep.id, parentSpanId: planSpanId },
        ),
      );
      const finalOutputs = await kernel.renderFinal(actions);
      await ensurePromise(
        emit({ type: "final", outputs: finalOutputs, reason: "no-plan" }, { spanId: traceSpanId }),
      );
      return { actions, final: finalOutputs, reason: "no-plan" };
    }

    for (const step of steps) {
      await ensurePromise(
        emit(
          { type: "progress", step: "act", pct: 0.4 },
          { spanId: step.id, parentSpanId: planSpanId },
        ),
      );
      await ensurePromise(
        emit(
          {
            type: "tool",
            name: step.op,
            args: step.args,
            status: "started",
          },
          { spanId: step.id, parentSpanId: planSpanId },
        ),
      );
      const outcome = await kernel.act(step);
      actions.push(outcome);
      await ensurePromise(
        emit(
          {
            type: "tool",
            name: step.op,
            args: step.args,
            result: outcome.result,
            cost:
              "cost" in outcome.result && typeof (outcome.result as any).cost === "number"
                ? (outcome.result as any).cost
                : undefined,
            latency_ms:
              "latency_ms" in outcome.result &&
              typeof (outcome.result as any).latency_ms === "number"
                ? (outcome.result as any).latency_ms
                : undefined,
            status: outcome.result.ok ? "succeeded" : "failed",
          },
          { spanId: step.id, parentSpanId: planSpanId },
        ),
      );

      if (!outcome.result.ok && outcome.result.retryable === false) {
        await ensurePromise(
          emit(
            {
              type: "log",
              level: "error",
              message: "non-retryable tool error encountered",
              detail: { step: step.id, error: outcome.result },
            },
            { spanId: step.id, parentSpanId: planSpanId },
          ),
        );
        const finalOutputs = await kernel.renderFinal(actions);
        await ensurePromise(
          emit(
            { type: "final", outputs: finalOutputs, reason: "non-retryable-error" },
            { spanId: traceSpanId },
          ),
        );
        return { actions, final: finalOutputs, reason: "non-retryable-error" };
      }

      if (outcome.ask) {
        await ensurePromise(
          emit(
            {
              type: "ask",
              question: outcome.ask.question,
              origin_step: outcome.ask.origin_step ?? step.id,
            },
            {
              spanId: outcome.ask.origin_step ?? step.id,
              parentSpanId: planSpanId,
            },
          ),
        );
        return { actions, reason: "ask" };
      }
    }

    lastReview = await kernel.review(actions);
    const reviewNotes = Array.isArray(lastReview.notes)
      ? lastReview.notes.filter((note): note is string => typeof note === "string" && note.trim().length > 0)
      : [];
    for (const note of reviewNotes) {
      await ensurePromise(
        emit(
          {
            type: "reflect.note",
            text: note,
            level: lastReview.passed ? "info" : "warn",
          },
          { spanId: planSpanId, parentSpanId: traceSpanId },
        ),
      );
    }
    await ensurePromise(
      emit(
        {
          type: "score",
          value: lastReview.score,
          passed: lastReview.passed,
          notes: lastReview.notes,
        },
        { spanId: planSpanId, parentSpanId: traceSpanId },
      ),
    );

    if (lastReview.passed) {
      const finalOutputs = await kernel.renderFinal(actions);
      await ensurePromise(
        emit(
          { type: "final", outputs: finalOutputs, reason: "completed" },
          { spanId: traceSpanId },
        ),
      );
      return {
        actions,
        final: finalOutputs,
        reason: "completed",
        review: lastReview,
      };
    }
  }

  await ensurePromise(
    emit(
      {
        type: "log",
        level: "warn",
        message: "max iterations reached without passing review",
      },
      { spanId: traceSpanId },
    ),
  );
  return { actions, reason: "max-iterations", review: lastReview };
}

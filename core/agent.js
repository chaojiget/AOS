/**
 * Minimal Agent kernel runtime utilities.
 * @module core/agent
 */

const DEFAULT_MAX_ITERATIONS = 5;

/**
 * @typedef {Object} PlannedStep
 * @property {string} id
 * @property {string} op
 * @property {any} [args]
 */

/**
 * @typedef {Object} AgentKernel
 * @property {(context:any)=>Promise<void>|void} [perceive]
 * @property {()=>Promise<{steps:PlannedStep[]}|null|undefined>} plan
 * @property {(step:PlannedStep, context?:any)=>Promise<any>} act
 * @property {(outputs:any[], context?:any)=>Promise<{score:number;passed:boolean;notes?:string[]}>|{score:number;passed:boolean;notes?:string[]}} [review]
 * @property {(outputs:any[], review?:any)=>Promise<any>|any} [renderFinal]
 * @property {(outputs:any[], review?:any)=>boolean} [thinksDone]
 */

function toISO(clock) {
  try {
    return (clock ? clock() : new Date()).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function serializeError(error) {
  if (!error || typeof error !== "object") {
    return { message: String(error) };
  }
  const plain = {
    name: error.name || "Error",
    message: error.message || String(error),
  };
  if (error.stack) plain.stack = String(error.stack);
  return plain;
}

async function callStep(fn, emit, source) {
  try {
    return await fn();
  } catch (error) {
    emit({ type: "error", error: serializeError(error), source });
    throw error;
  }
}

/**
 * Execute a kernel run-loop and emit events for each stage.
 * @param {AgentKernel} kernel
 * @param {(event: Record<string, any>) => void} emit
 * @param {{ maxIterations?: number, context?: any, clock?: () => Date }} [options]
 * @returns {Promise<{ status: 'final'|'ask', outputs: any, reason?: string }>}
 */
export async function runLoop(kernel, emit, options = {}) {
  if (!kernel || typeof kernel !== "object") {
    throw new TypeError("kernel must be an object implementing AgentKernel");
  }
  if (typeof emit !== "function") {
    throw new TypeError("emit must be a function");
  }

  const { maxIterations = DEFAULT_MAX_ITERATIONS, context, clock } = options;
  const outputs = [];

  if (typeof kernel.perceive === "function") {
    emit({ type: "progress", step: "perceive", pct: 0 });
    await callStep(() => kernel.perceive(context), emit, "perceive");
    emit({ type: "progress", step: "perceive", pct: 1 });
  }

  let iterations = 0;
  while (iterations < maxIterations) {
    iterations += 1;
    emit({ type: "progress", step: "plan", pct: 0, iteration: iterations });
    const plan = await callStep(() => kernel.plan(context), emit, "plan");
    emit({ type: "plan.ready", at: toISO(clock), plan: plan ?? null, iteration: iterations });

    const steps = Array.isArray(plan?.steps) ? plan.steps : [];
    if (steps.length === 0) {
      const fallbackStep = { id: "final", op: "respond", args: { reason: "no-plan" } };
      let fallback;
      if (typeof kernel.act === "function") {
        fallback = await callStep(() => kernel.act(fallbackStep, context), emit, "act");
        outputs.push(fallback);
        emit({
          type: "tool",
          name: fallbackStep.op,
          args: fallbackStep.args,
          result: fallback,
          ts: toISO(clock),
        });
      }
      const finalOut =
        typeof kernel.renderFinal === "function"
          ? await callStep(() => kernel.renderFinal(outputs), emit, "final")
          : fallback;
      emit({ type: "final", reason: "no-plan", outputs: finalOut, ts: toISO(clock) });
      return { status: "final", reason: "no-plan", outputs: finalOut };
    }

    emit({ type: "progress", step: "plan", pct: 1, iteration: iterations, steps: steps.length });

    let awaitingUser = false;
    for (const step of steps) {
      emit({ type: "act.begin", step, ts: toISO(clock) });
      const result = await callStep(() => kernel.act(step, context), emit, "act");
      emit({ type: "tool", name: step.op, args: step.args, result, ts: toISO(clock) });
      emit({ type: "act.end", step, ok: !(result && result.error), ts: toISO(clock) });
      outputs.push(result);

      if (result && typeof result.ask === "string") {
        awaitingUser = true;
        emit({ type: "ask", question: result.ask, origin_step: step.id, ts: toISO(clock) });
        break;
      }
      if (result && result.halt) {
        emit({ type: "halt", reason: result.halt, ts: toISO(clock) });
        awaitingUser = true;
        break;
      }
    }

    if (awaitingUser) {
      return { status: "ask", outputs };
    }

    const review =
      typeof kernel.review === "function"
        ? await callStep(() => kernel.review(outputs, context), emit, "review")
        : { score: 1, passed: true };
    emit({
      type: "score",
      value: review?.score ?? 0,
      passed: Boolean(review?.passed),
      notes: review?.notes,
      ts: toISO(clock),
    });

    const done =
      Boolean(review?.passed) ||
      (typeof kernel.thinksDone === "function" && kernel.thinksDone(outputs, review));
    if (done) {
      const finalOutputs =
        typeof kernel.renderFinal === "function"
          ? await callStep(() => kernel.renderFinal(outputs, review), emit, "final")
          : outputs;
      emit({ type: "final", outputs: finalOutputs, ts: toISO(clock) });
      return { status: "final", outputs: finalOutputs };
    }

    emit({
      type: "progress",
      step: "loop",
      iteration: iterations,
      pct: iterations / maxIterations,
    });
  }

  const finalOutputs =
    typeof kernel.renderFinal === "function"
      ? await callStep(() => kernel.renderFinal(outputs), emit, "final")
      : outputs;
  emit({ type: "final", outputs: finalOutputs, reason: "max-iterations", ts: toISO(clock) });
  return { status: "final", reason: "max-iterations", outputs: finalOutputs };
}

export default {
  runLoop,
};

import { readFile } from "node:fs/promises";
import {
  ToolInvoker,
  ToolCall,
  ToolResult,
  ToolOk,
  ToolError,
  AgentKernel,
  Plan,
  PlanStep,
  ActionOutcome,
  ReviewResult,
  AskRequest,
} from "../core/agent";
import type { ChatMessage } from "../types/chat";
import { buildChatCompletionsUrl, loadLLMConfig } from "../config/llm";

export const DEFAULT_SYSTEM_PROMPT = {
  role: "system",
  content: "你是一位中文助手，请始终使用简体中文回答。",
} satisfies ChatMessage;

async function handleHttpGet(args: any): Promise<ToolResult> {
  const url = args?.url;
  if (!url) {
    return { ok: false, code: "http.invalid_url", message: "url is required" };
  }
  try {
    const response = await fetch(url);
    const body = await response.text();
    return {
      ok: true,
      data: {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
      },
      latency_ms: 0,
    } satisfies ToolOk;
  } catch (err: any) {
    return {
      ok: false,
      code: "http.error",
      message: err?.message ?? "request failed",
      retryable: true,
    } satisfies ToolError;
  }
}

async function handleFileRead(args: any): Promise<ToolResult> {
  const path = args?.path;
  if (!path) {
    return { ok: false, code: "file.invalid_path", message: "path is required" };
  }
  try {
    const content = await readFile(path, "utf8");
    return { ok: true, data: { path, content } } satisfies ToolOk;
  } catch (err: any) {
    return {
      ok: false,
      code: "file.read_error",
      message: err?.message ?? "failed to read file",
    } satisfies ToolError;
  }
}

function handleEcho(args: any): ToolResult {
  return { ok: true, data: args } satisfies ToolOk;
}

function normaliseMessages(args: any): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (Array.isArray(args?.messages)) {
    for (const item of args.messages) {
      if (item && typeof item.role === "string" && typeof item.content === "string") {
        messages.push({ role: item.role, content: item.content });
      }
    }
  }

  const prompt = typeof args?.prompt === "string" ? args.prompt.trim() : "";
  if (prompt) {
    messages.push({ role: "user", content: prompt });
  }

  return messages;
}

async function handleChat(args: any): Promise<ToolResult> {
  let config;
  try {
    config = loadLLMConfig();
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown configuration error";
    return {
      ok: false,
      code: "llm.config_error",
      message,
    } satisfies ToolError;
  }

  const messages = normaliseMessages(args);
  if (messages.length === 0) {
    return {
      ok: false,
      code: "llm.invalid_args",
      message: "prompt or messages must be provided",
    } satisfies ToolError;
  }

  const url = buildChatCompletionsUrl(config);
  const temperature = typeof args?.temperature === "number" ? args.temperature : 0;
  const maxTokens = typeof args?.max_tokens === "number" ? args.max_tokens : undefined;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        ...(config.organization ? { "OpenAI-Organization": config.organization } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature,
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
      }),
    });

    if (!response.ok) {
      let detail: unknown;
      try {
        detail = await response.json();
      } catch {
        detail = await response.text();
      }

      const message =
        typeof (detail as any)?.error?.message === "string"
          ? (detail as any).error.message
          : typeof detail === "string"
            ? detail
            : `request failed (${response.status})`;

      return {
        ok: false,
        code: "llm.http_error",
        message,
        retryable: response.status >= 500,
      } satisfies ToolError;
    }

    const payload = (await response.json()) as {
      id?: string;
      choices?: Array<{ message?: ChatMessage; finish_reason?: string }>;
      model?: string;
      usage?: Record<string, unknown>;
    };

    const choice = payload.choices?.[0];
    const content = choice?.message?.content ?? "";

    return {
      ok: true,
      data: {
        id: payload.id,
        model: payload.model ?? config.model,
        content,
        choices: payload.choices,
        usage: payload.usage,
        finish_reason: choice?.finish_reason,
      },
    } satisfies ToolOk;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return {
      ok: false,
      code: "llm.network_error",
      message,
      retryable: true,
    } satisfies ToolError;
  }
}

export function createDefaultToolInvoker(): ToolInvoker {
  return async (call: ToolCall, _ctx: any) => {
    switch (call.name) {
      case "echo":
        return handleEcho(call.args);
      case "http.get":
        return handleHttpGet(call.args);
      case "file.read":
        return handleFileRead(call.args);
      case "llm.chat":
        return handleChat(call.args);
      default:
        return {
          ok: false,
          code: "tool.not_found",
          message: `tool ${call.name} is not available`,
        } satisfies ToolError;
    }
  };
}

export function summarizeToolResult(result: ToolResult): any {
  if (result.ok) {
    const data = result.data;
    if (typeof data === "string") {
      return data.length > 160 ? `${data.slice(0, 157)}...` : data;
    }
    if (data && typeof data === "object" && "content" in data) {
      const text = (data as any).content;
      if (typeof text === "string") {
        return text.length > 160 ? `${text.slice(0, 157)}...` : text;
      }
    }
    return data;
  }
  return { code: result.code, message: result.message };
}

interface ChatKernelOptions {
  message: string;
  traceId: string;
  toolInvoker: ToolInvoker;
  history?: ChatMessage[];
}

class ChatKernel implements AgentKernel {
  private perceived = false;
  private planCount = 0;
  private actions: ActionOutcome[] = [];
  private readonly history: ChatMessage[];
  private readonly stepRevision = new Map<string, number>();

  constructor(private readonly options: ChatKernelOptions) {
    const baseHistory = Array.isArray(options.history)
      ? options.history.map((msg) => ({ role: msg.role, content: msg.content }))
      : [];

    const filteredHistory = baseHistory.filter(
      (msg) =>
        !(
          msg.role === DEFAULT_SYSTEM_PROMPT.role &&
          msg.content === DEFAULT_SYSTEM_PROMPT.content
        ),
    );

    this.history = [DEFAULT_SYSTEM_PROMPT, ...filteredHistory];
  }

  async perceive(): Promise<void> {
    this.perceived = true;
  }

  async plan(): Promise<Plan> {
    this.planCount += 1;
    if (!this.perceived) {
      throw new Error("perceive must be called before plan");
    }
    const combinedHistory = [
      ...this.history,
      ...(this.options.message
        ? [{ role: "user", content: this.options.message } satisfies ChatMessage]
        : []),
    ];

    const plannerCall: ToolCall = {
      name: "planner.plan",
      args: {
        goal: this.options.message ?? "",
        history: combinedHistory,
        revision: this.planCount,
      },
    };

    const plannerContext = {
      trace_id: this.options.traceId,
      span_id: `plan-${this.planCount}-planner`,
    };

    let plannerResult: ToolResult | undefined;
    try {
      plannerResult = await this.options.toolInvoker(plannerCall, plannerContext);
    } catch (err) {
      plannerResult = {
        ok: false,
        code: "planner.invoke_failed",
        message: err instanceof Error ? err.message : "planner invocation failed",
      } satisfies ToolError;
    }

    const ensurePlannerData = (result: ToolResult | undefined): any => {
      if (!result) return undefined;
      if (!result.ok) {
        return { error: result.message };
      }

      const data = result.data;
      if (typeof data === "string") {
        try {
          return JSON.parse(data);
        } catch {
          return { steps: [], notes: ["planner returned non-JSON string"] };
        }
      }
      return data;
    };

    const plannerData = ensurePlannerData(plannerResult);

    const plannerStepsSource = Array.isArray(plannerData?.steps)
      ? plannerData.steps
      : Array.isArray(plannerData)
        ? plannerData
        : Array.isArray(plannerData?.plan?.steps)
          ? plannerData.plan.steps
          : [];

    const steps: PlanStep[] = [];
    for (let index = 0; index < plannerStepsSource.length; index += 1) {
      const raw = plannerStepsSource[index];
      if (!raw || typeof raw.op !== "string" || !raw.op.trim()) {
        continue;
      }

      const args =
        raw.args && typeof raw.args === "object" ? { ...raw.args } : {};

      if (
        raw.op === "llm.chat" &&
        !Array.isArray(args.messages) &&
        typeof args.prompt !== "string"
      ) {
        args.messages = combinedHistory;
      }

      const stepId =
        typeof raw.id === "string" && raw.id.trim()
          ? raw.id
          : `${this.options.traceId}-r${this.planCount}-s${index + 1}`;

      const step: PlanStep = {
        id: stepId,
        op: raw.op,
        args,
        ...(typeof raw.description === "string" && raw.description.trim()
          ? { description: raw.description }
          : {}),
      } satisfies PlanStep;

      this.stepRevision.set(step.id, this.planCount);
      steps.push(step);
    }

    if (steps.length > 0) {
      const planNotes = Array.isArray(plannerData?.notes)
        ? plannerData.notes.filter((note: unknown): note is string =>
            typeof note === "string" && note.trim() !== "",
          )
        : undefined;

      return {
        revision: this.planCount,
        reason:
          typeof plannerData?.reason === "string"
            ? plannerData.reason
            : this.planCount === 1
              ? "initial"
              : "retry",
        notes: planNotes,
        steps,
      } satisfies Plan;
    }

    const fallbackStep: PlanStep = {
      id: `${this.options.traceId}-r${this.planCount}-s1`,
      op: "llm.chat",
      args: { messages: combinedHistory },
      description: "fallback chat response",
    } satisfies PlanStep;
    this.stepRevision.set(fallbackStep.id, this.planCount);

    const fallbackNotes: string[] = [];
    if (plannerResult && !plannerResult.ok) {
      fallbackNotes.push(`planner failed: ${plannerResult.message}`);
    }

    return {
      revision: this.planCount,
      reason: "fallback",
      notes: fallbackNotes.length ? fallbackNotes : undefined,
      steps: [fallbackStep],
    } satisfies Plan;
  }

  async act(step: PlanStep): Promise<ActionOutcome> {
    const makeAskOutcome = (ask: AskRequest): ActionOutcome => {
      const outcome: ActionOutcome = {
        step,
        result: { ok: true, data: null },
        ask,
      } satisfies ActionOutcome;
      this.actions.push(outcome);
      return outcome;
    };

    if (step.op === "ask.user" || step.op === "ask") {
      const question =
        typeof (step.args as any)?.question === "string"
          ? (step.args as any).question
          : "请补充更多信息";
      const ask: AskRequest = {
        question,
        origin_step: step.id,
        detail: (step.args as any)?.detail,
      } satisfies AskRequest;
      return makeAskOutcome(ask);
    }

    const revision = this.stepRevision.get(step.id);
    const context = {
      trace_id: this.options.traceId,
      span_id: step.id,
      ...(revision ? { metadata: { revision } } : {}),
    };

    const resolveCall = (): ToolCall | null => {
      if (!step.op || typeof step.op !== "string") {
        return null;
      }

      if (step.op.startsWith("mcp")) {
        const normalised = step.op.replace(/^mcp(:\/\/)?/, "");
        const separator = normalised.includes("/") ? "/" : ".";
        const [server, tool] = normalised.split(separator, 2);
        if (!server || !tool) {
          return null;
        }
        return {
          name: "mcp.invoke",
          args: { server, tool, input: step.args },
        } satisfies ToolCall;
      }

      if (step.op.startsWith("local.")) {
        return {
          name: step.op.slice("local.".length),
          args: step.args,
        } satisfies ToolCall;
      }

      return { name: step.op, args: step.args } satisfies ToolCall;
    };

    const call = resolveCall();

    if (!call) {
      const result: ToolError = {
        ok: false,
        code: "plan.invalid_step",
        message: `无法识别的操作: ${String(step.op)}`,
      } satisfies ToolError;
      const outcome: ActionOutcome = { step, result };
      this.actions.push(outcome);
      return outcome;
    }

    let result: ToolResult;
    try {
      result = await this.options.toolInvoker(call, context);
    } catch (err) {
      result = {
        ok: false,
        code: "tool.invoke_failed",
        message: err instanceof Error ? err.message : "unknown tool error",
        retryable: false,
      } satisfies ToolError;
    }

    const outcome: ActionOutcome = { step, result };

    if (!result.ok && result.code === "ask.required") {
      outcome.ask = {
        question: result.message,
        origin_step: step.id,
        detail: { code: result.code },
      } satisfies AskRequest;
    }

    this.actions.push(outcome);
    return outcome;
  }

  async review(actions: ActionOutcome[]): Promise<ReviewResult> {
    if (!Array.isArray(actions) || actions.length === 0) {
      return {
        score: 0,
        passed: false,
        notes: ["尚未执行任何步骤"],
      } satisfies ReviewResult;
    }

    const revision = this.planCount;
    const currentRevisionActions = actions.filter(
      (action) => this.stepRevision.get(action.step.id) === revision,
    );

    const considered = currentRevisionActions.length > 0 ? currentRevisionActions : actions;

    const total = considered.length;
    let successCount = 0;
    const notes: string[] = [];
    const failures: ActionOutcome[] = [];
    const asks: ActionOutcome[] = [];

    for (const action of considered) {
      if (action.ask) {
        asks.push(action);
      }
      if (action.result.ok) {
        successCount += 1;
      } else {
        failures.push(action);
      }
    }

    if (asks.length > 0) {
      notes.push(
        `等待用户补充信息：${asks
          .map((ask) => ask.ask?.question ?? ask.step.id)
          .join("; ")}`,
      );
    }

    for (const failure of failures) {
      const message = failure.result.ok
        ? ""
        : failure.result.message ?? "unknown error";
      notes.push(`步骤 ${failure.step.id} 失败：${message}`);
    }

    const previousFailures = actions.filter(
      (action) =>
        this.stepRevision.get(action.step.id) !== revision && !action.result.ok,
    );
    if (previousFailures.length > 0) {
      notes.push(
        `历史失败步骤：${previousFailures
          .map((item) => item.step.id)
          .join(", ")}`,
      );
    }

    const score = total > 0 ? successCount / total : 0;
    const passed = failures.length === 0 && asks.length === 0 && total > 0;

    if (passed) {
      notes.push(`第 ${revision} 轮计划全部完成`);
    } else if (notes.length === 0) {
      notes.push("计划未通过评审");
    }

    return {
      score,
      passed,
      notes,
    } satisfies ReviewResult;
  }

  async renderFinal(actions: ActionOutcome[]): Promise<any> {
    const latest = actions.at(-1);
    if (!latest) return { text: "" };
    if (latest.result.ok) {
      const data = latest.result.data;
      if (typeof data === "string") {
        return { text: data };
      }
      if (data && typeof data === "object" && "content" in data) {
        const text = (data as any).content;
        return { text, raw: data };
      }
      return { text: JSON.stringify(data), raw: data };
    }
    return { error: latest.result };
  }
}

export function createChatKernel(options: ChatKernelOptions): AgentKernel {
  return new ChatKernel(options);
}

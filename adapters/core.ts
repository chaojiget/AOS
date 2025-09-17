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
  private readonly plannerInstruction =
    "你是一名善于拆解任务的规划助手，需要把复杂目标分解为一系列可以调用工具或 MCP 能力的步骤。";

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

    const revision = this.planCount;
    const defaultPlan: Plan = {
      revision,
      reason: revision === 1 ? "initial" : "retry",
      steps: [
        {
          id: `${this.options.traceId}-step-${revision}`,
          op: "llm.chat",
          args: { messages: combinedHistory },
        },
      ],
    } satisfies Plan;

    const planMessages = this.buildPlanningMessages();
    let plannerResult: ToolResult | undefined;
    try {
      plannerResult = await this.options.toolInvoker(
        { name: "llm.chat", args: { messages: planMessages, temperature: 0 } },
        { trace_id: this.options.traceId, span_id: `plan-${revision}` },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ...defaultPlan,
        notes: [`plan invocation failed: ${message}`],
      } satisfies Plan;
    }

    if (!plannerResult.ok) {
      return {
        ...defaultPlan,
        notes: [`plan invocation error: ${plannerResult.message}`],
      } satisfies Plan;
    }

    const parsed = this.parsePlanResult(plannerResult.data, revision);
    if (!parsed.steps.length) {
      return {
        ...defaultPlan,
        notes: parsed.notes?.length
          ? [...(defaultPlan.notes ?? []), ...parsed.notes]
          : defaultPlan.notes,
      } satisfies Plan;
    }

    return {
      revision,
      reason: parsed.reason ?? (revision === 1 ? "initial" : "retry"),
      notes: parsed.notes,
      steps: parsed.steps,
    } satisfies Plan;
  }

  async act(step: PlanStep): Promise<ActionOutcome> {
    if (this.isAskStep(step)) {
      const ask = this.buildAsk(step);
      const outcome: ActionOutcome = { step, result: { ok: true, data: null }, ask };
      this.actions.push(outcome);
      return outcome;
    }

    const call = this.resolveToolCall(step);
    let result: ToolResult;
    try {
      if (!call) {
        result = {
          ok: false,
          code: "tool.unsupported",
          message: `unsupported operation: ${step.op}`,
        } satisfies ToolError;
      } else {
        result = await this.options.toolInvoker(call, {
          trace_id: this.options.traceId,
          span_id: step.id,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = {
        ok: false,
        code: "tool.invoke_error",
        message,
      } satisfies ToolError;
    }

    const outcome: ActionOutcome = { step, result };
    this.actions.push(outcome);
    return outcome;
  }

  async review(actions: ActionOutcome[]): Promise<ReviewResult> {
    const executed = actions.length ? actions : this.actions;
    const failures = executed.filter((item) => !item.result.ok);
    if (failures.length) {
      const lastFailure = failures.at(-1)!;
      const message =
        (lastFailure.result as ToolError).message ?? (lastFailure.result as ToolError).code;
      return {
        score: Math.max(0, executed.length - failures.length),
        passed: false,
        notes: [`${lastFailure.step.op} failed: ${message}`],
      } satisfies ReviewResult;
    }

    const latest = executed.at(-1);
    return {
      score: executed.length,
      passed: true,
      notes: latest ? [`${latest.step.op} succeeded`] : undefined,
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

  private buildPlanningMessages(): ChatMessage[] {
    const conversation = this.history
      .filter((msg) => !(msg.role === DEFAULT_SYSTEM_PROMPT.role && msg.content === DEFAULT_SYSTEM_PROMPT.content))
      .map((msg) => {
        const speaker = msg.role === "user" ? "用户" : msg.role === "assistant" ? "助手" : msg.role;
        return `${speaker}: ${msg.content}`;
      })
      .join("\n");

    const latestDemand = this.options.message?.trim() ?? "";
    const promptSections = [
      conversation ? `以下是最近的对话上下文：\n${conversation}` : null,
      latestDemand ? `当前用户需求：${latestDemand}` : null,
      "请针对需求生成一个结构化的执行计划，列出 1-5 个步骤。每个步骤包含 id、op、args、description 字段。",
      "支持的 op 可以是 llm.chat、mcp-core.*、mcp-memory.* 或其他注册工具。输出必须是 JSON 对象或数组，必要时可包含 reason、notes。",
    ].filter(Boolean);

    return [
      DEFAULT_SYSTEM_PROMPT,
      { role: "system", content: this.plannerInstruction },
      { role: "user", content: promptSections.join("\n\n") },
    ];
  }

  private parsePlanResult(
    data: any,
    revision: number,
  ): { steps: PlanStep[]; reason?: string; notes?: string[] } {
    const parsed = this.extractPlanPayload(data);
    if (!parsed) {
      return { steps: [] };
    }

    const stepsInput = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.steps)
        ? parsed.steps
        : [];
    const reason = typeof parsed?.reason === "string" ? parsed.reason : undefined;
    const notes = Array.isArray(parsed?.notes)
      ? parsed.notes.filter((item) => typeof item === "string")
      : undefined;

    const steps: PlanStep[] = [];
    for (const [index, item] of stepsInput.entries()) {
      if (!item || typeof item !== "object") continue;
      const op = typeof (item as any).op === "string" ? (item as any).op.trim() : "";
      if (!op) continue;
      const idRaw = (item as any).id;
      const id =
        typeof idRaw === "string" && idRaw.trim()
          ? idRaw.trim()
          : `${this.options.traceId}-step-${revision}-${index + 1}`;
      const args = (item as any).args ?? {};
      const description = typeof (item as any).description === "string" ? (item as any).description : undefined;
      steps.push({ id, op, args, description });
    }

    return { steps, reason, notes };
  }

  private extractPlanPayload(data: any): any {
    if (!data) return null;
    if (Array.isArray(data)) return data;
    if (typeof data === "object") {
      if (Array.isArray((data as any).steps)) {
        return data;
      }
      if (typeof (data as any).content === "string") {
        return this.tryParseJson((data as any).content);
      }
    }
    if (typeof data === "string") {
      return this.tryParseJson(data);
    }
    return null;
  }

  private tryParseJson(text: string): any {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonText = fenceMatch ? fenceMatch[1] : trimmed;
    try {
      return JSON.parse(jsonText);
    } catch (err) {
      return null;
    }
  }

  private isAskStep(step: PlanStep): boolean {
    return step.op === "agent.ask" || step.op === "ask" || step.op === "agent.request_clarification";
  }

  private buildAsk(step: PlanStep): { question: string; origin_step: string; detail?: any } {
    const args = step.args ?? {};
    const question =
      typeof (args as any)?.question === "string"
        ? (args as any).question
        : this.options.message ?? "需要更多信息";
    const detail = (args as any)?.detail;
    return { question, origin_step: step.id, detail };
  }

  private resolveToolCall(step: PlanStep): ToolCall | null {
    if (!step.op) {
      return null;
    }
    const args = step.args ?? {};
    if (step.op.startsWith("mcp-")) {
      const segments = step.op.split(".");
      const server = segments.shift();
      const tool = segments.join(".");
      if (server && tool) {
        if (args && typeof args === "object" && "server" in (args as any) && "tool" in (args as any)) {
          return { name: "mcp.invoke", args } satisfies ToolCall;
        }
        return {
          name: "mcp.invoke",
          args: { server, tool, params: args },
        } satisfies ToolCall;
      }
    }
    return { name: step.op, args } satisfies ToolCall;
  }
}

export function createChatKernel(options: ChatKernelOptions): AgentKernel {
  return new ChatKernel(options);
}

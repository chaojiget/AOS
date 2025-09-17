import {
  ToolInvoker,
  ToolCall,
  ToolResult,
  ToolOk,
  ToolError,
  ToolContext,
  AgentKernel,
  Plan,
  PlanStep,
  ActionOutcome,
  ReviewResult,
} from "../core/agent";
import type { ChatMessage } from "../types/chat";
import { createMcpRegistry, type CreateMcpRegistryOptions } from "./mcp";
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

export interface DefaultToolInvokerOptions extends CreateMcpRegistryOptions {}

export function createDefaultToolInvoker(options: DefaultToolInvokerOptions = {}): ToolInvoker {
  const mcpRegistry = createMcpRegistry(options);
  return async (call: ToolCall, ctx: ToolContext) => {
    const mcpResult = await mcpRegistry.invoke(call, ctx);
    if (mcpResult !== null) {
      return mcpResult;
    }
    switch (call.name) {
      case "echo":
        return handleEcho(call.args);
      case "http.get":
        return handleHttpGet(call.args);
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

    return {
      revision: this.planCount,
      reason: this.planCount === 1 ? "initial" : "retry",
      steps: [
        {
          id: `${this.options.traceId}-step-${this.planCount}`,
          op: "llm.chat",
          args: { messages: combinedHistory },
        },
      ],
    } satisfies Plan;
  }

  async act(step: PlanStep): Promise<ActionOutcome> {
    const result = await this.options.toolInvoker(
      { name: step.op, args: step.args },
      {
        trace_id: this.options.traceId,
        span_id: step.id,
      },
    );
    const outcome: ActionOutcome = { step, result };
    this.actions.push(outcome);
    return outcome;
  }

  async review(actions: ActionOutcome[]): Promise<ReviewResult> {
    const latest = actions.at(-1);
    const passed = Boolean(latest?.result.ok);
    return {
      score: passed ? 1 : 0,
      passed,
      notes: passed ? ["auto-pass: chat response generated"] : ["tool invocation failed"],
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

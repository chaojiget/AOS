import { readFile } from "node:fs/promises";
import { loadLLMConfig } from "../config/llm.js";
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
} from "../core/agent.js";

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

async function handleChat(args: any): Promise<ToolResult> {
  const prompt = typeof args?.prompt === "string" ? args.prompt.trim() : "";
  const messageList = Array.isArray(args?.messages) ? args.messages : [];

  const messages = messageList
    .map((msg: any) => {
      if (!msg || typeof msg?.content !== "string") {
        return null;
      }
      const role =
        typeof msg.role === "string" && msg.role.trim().length > 0
          ? msg.role
          : "user";
      return { role, content: msg.content };
    })
    .filter(Boolean) as Array<{ role: string; content: string }>;

  if (prompt.length > 0) {
    messages.push({ role: "user", content: prompt });
  }

  if (messages.length === 0) {
    return {
      ok: false,
      code: "llm.invalid_request",
      message: "prompt or messages are required",
    } satisfies ToolError;
  }

  let config;
  try {
    config = loadLLMConfig();
  } catch (err: any) {
    return {
      ok: false,
      code: "llm.config_error",
      message: err?.message ?? "LLM configuration error",
    } satisfies ToolError;
  }

  const url = `${config.baseUrl}/chat/completions`;
  const payload: Record<string, any> = {
    model: config.model,
    messages,
    temperature: typeof args?.temperature === "number" ? args.temperature : 0,
  };

  if (typeof args?.max_tokens === "number") {
    payload.max_tokens = args.max_tokens;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  };

  const start = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (err: any) {
    return {
      ok: false,
      code: "llm.network_error",
      message: err?.message ?? "Failed to reach LLM service",
      retryable: true,
    } satisfies ToolError;
  }

  const latencyMs = Date.now() - start;
  let responseBody: any = null;
  const isJson = response.headers.get("content-type")?.includes("application/json");

  if (!response.ok) {
    if (isJson) {
      try {
        responseBody = await response.json();
      } catch (error) {
        // ignore JSON parse errors for error responses
      }
    } else {
      try {
        responseBody = await response.text();
      } catch (error) {
        responseBody = null;
      }
    }

    const errorMessage =
      typeof responseBody?.error?.message === "string"
        ? responseBody.error.message
        : typeof responseBody === "string"
          ? responseBody
          : `LLM request failed with status ${response.status}`;

    return {
      ok: false,
      code: "llm.api_error",
      message: errorMessage,
      retryable: response.status >= 500,
    } satisfies ToolError;
  }

  try {
    responseBody = isJson ? await response.json() : await response.text();
  } catch (err: any) {
    return {
      ok: false,
      code: "llm.invalid_response",
      message: err?.message ?? "Failed to parse LLM response",
    } satisfies ToolError;
  }

  if (!isJson) {
    const textBody = typeof responseBody === "string" ? responseBody : "";
    if (!textBody) {
      return {
        ok: false,
        code: "llm.invalid_response",
        message: "LLM response missing content",
      } satisfies ToolError;
    }
    return {
      ok: true,
      data: { content: textBody, raw: textBody },
      latency_ms: latencyMs,
    } satisfies ToolOk;
  }

  const choice = responseBody?.choices?.[0];
  const message = choice?.message ?? {};
  const content =
    typeof message?.content === "string"
      ? message.content
      : typeof choice?.text === "string"
        ? choice.text
        : "";

  if (!content) {
    return {
      ok: false,
      code: "llm.invalid_response",
      message: "LLM response did not include any content",
    } satisfies ToolError;
  }

  return {
    ok: true,
    data: {
      content,
      role: typeof message?.role === "string" ? message.role : "assistant",
      raw: responseBody,
    },
    latency_ms: latencyMs,
    cost:
      typeof responseBody?.usage?.total_tokens === "number"
        ? responseBody.usage.total_tokens
        : undefined,
  } satisfies ToolOk;
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
}

class ChatKernel implements AgentKernel {
  private perceived = false;
  private planCount = 0;
  private actions: ActionOutcome[] = [];

  constructor(private readonly options: ChatKernelOptions) {}

  async perceive(): Promise<void> {
    this.perceived = true;
  }

  async plan(): Promise<Plan> {
    this.planCount += 1;
    if (!this.perceived) {
      throw new Error("perceive must be called before plan");
    }
    return {
      revision: this.planCount,
      reason: this.planCount === 1 ? "initial" : "retry",
      steps: [
        {
          id: `${this.options.traceId}-step-${this.planCount}`,
          op: "llm.chat",
          args: { prompt: this.options.message },
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

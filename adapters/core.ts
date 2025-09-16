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

function handleChat(args: any): ToolResult {
  const prompt = args?.prompt;
  const messages = Array.isArray(args?.messages) ? args.messages : [];
  const content =
    typeof prompt === "string" && prompt.trim().length
      ? prompt
      : messages
          .map((m: any) => m?.content)
          .filter(Boolean)
          .join("\n");

  const reply =
    content?.length > 0
      ? `Echoing (${content.length} chars): ${content}`
      : "Hello! I am a local chat kernel. Provide a prompt to continue.";

  return { ok: true, data: { content: reply } } satisfies ToolOk;
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

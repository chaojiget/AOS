import { readFile } from "node:fs/promises";
import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  OpenAIError,
} from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
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
  AskRequest,
} from "../core/agent";
import type { ChatMessage } from "../types/chat";
import { loadLLMConfig } from "../config/llm";
import type { LLMConfig } from "../config/llm";
import {
  createMCPClient,
  type MCPClient,
  createMcpRegistry,
  type CreateMcpRegistryOptions,
} from "./mcp";

export const DEFAULT_SYSTEM_PROMPT = {
  role: "system",
  content: "你是一位中文助手，请始终使用简体中文回答。",
} satisfies ChatMessage;

// URL验证规则：防止内部网络扫描和潜在的SSRF攻击
function validateUrl(urlString: string): void {
  try {
    const url = new URL(urlString);

    // 只允许HTTPS协议
    if (url.protocol !== "https:") {
      throw new Error("仅允许HTTPS URLs");
    }

    // 检查是否为私有IP/内网地址 (IPv4)
    if (url.hostname.match(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|0\.)/)) {
      throw new Error("不允许访问私有网络地址");
    }

    // 检查是否为IPv6私有地址
    if (url.hostname.match(/^((::1)|(::ffff:(:0+)?192\.|::ffff:(:0+)?10\.|::ffff:(:0+)?172\.(1[6-9]|2\d|3[01])\.))/)) {
      throw new Error("不允许访问IPv6私有地址");
    }

    // 检查localhost/本地host
    if (["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname.toLowerCase())) {
      throw new Error("不允许访问本地主机");
    }

  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("无效的URL格式");
  }
}

async function handleHttpGet(args: any): Promise<ToolResult> {
  const url = args?.url;
  if (!url) {
    return { ok: false, code: "http.invalid_url", message: "url is required" };
  }

  try {
    // 验证URL安全性
    validateUrl(url);

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

const DEFAULT_LLM_TIMEOUT_MS = 30_000;

interface OpenAiClientLike {
  chat: {
    completions: {
      create(
        params: {
          model: string;
          messages: ChatCompletionMessageParam[];
          temperature: number;
          max_tokens?: number;
        },
        options?: { timeout?: number },
      ): Promise<any>;
    };
  };
}

type OpenAiFactory = (config: LLMConfig, timeoutMs: number) => OpenAiClientLike;

const defaultOpenAiFactory: OpenAiFactory = (config, timeoutMs) =>
  new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    organization: config.organization ?? undefined,
    timeout: timeoutMs,
  });

let openAiFactory: OpenAiFactory = defaultOpenAiFactory;

export function setOpenAiFactoryForTesting(factory?: OpenAiFactory): void {
  openAiFactory = factory ?? defaultOpenAiFactory;
}
function resolveLlmTimeout(): number {
  const raw = process.env.OPENAI_TIMEOUT_MS ?? process.env.LLM_TIMEOUT_MS;
  if (!raw) {
    return DEFAULT_LLM_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LLM_TIMEOUT_MS;
}

function toOpenAiMessage(message: ChatMessage): ChatCompletionMessageParam {
  switch (message.role) {
    case "system":
      return { role: "system", content: message.content } satisfies ChatCompletionMessageParam;
    case "assistant":
      return { role: "assistant", content: message.content } satisfies ChatCompletionMessageParam;
    case "developer":
      return { role: "developer", content: message.content } satisfies ChatCompletionMessageParam;
    case "user":
      return { role: "user", content: message.content } satisfies ChatCompletionMessageParam;
    default:
      return { role: "user", content: message.content } satisfies ChatCompletionMessageParam;
  }
}

function mapOpenAiError(error: unknown): ToolError {
  if (error instanceof APIConnectionTimeoutError) {
    return {
      ok: false,
      code: "llm.timeout",
      message: error.message,
      retryable: true,
    } satisfies ToolError;
  }

  if (error instanceof APIConnectionError) {
    return {
      ok: false,
      code: "llm.network_error",
      message: error.message,
      retryable: true,
    } satisfies ToolError;
  }

  if (error instanceof APIError) {
    const status = typeof error.status === "number" ? error.status : 0;
    const retryable = status >= 500 || status === 429;
    const code =
      status === 401 || status === 403
        ? "llm.auth_error"
        : status === 429
          ? "llm.rate_limited"
          : "llm.http_error";
    return {
      ok: false,
      code,
      message: error.message,
      retryable,
    } satisfies ToolError;
  }

  if (error instanceof OpenAIError) {
    return {
      ok: false,
      code: "llm.error",
      message: error.message,
    } satisfies ToolError;
  }

  const message = error instanceof Error ? error.message : "unknown error";
  return {
    ok: false,
    code: "llm.unknown_error",
    message,
  } satisfies ToolError;
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

  const temperature = typeof args?.temperature === "number" ? args.temperature : 0;
  const maxTokens = typeof args?.max_tokens === "number" ? args.max_tokens : undefined;
  const timeoutMs = resolveLlmTimeout();
  const client = openAiFactory(config, timeoutMs);
  const openAiMessages = messages.map(toOpenAiMessage);
  const startedAt = Date.now();

  try {
    const response = await client.chat.completions.create(
      {
        model: config.model,
        messages: openAiMessages,
        temperature,
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
      },
      { timeout: timeoutMs },
    );

    const latencyMs = Date.now() - startedAt;
    const choice = response.choices?.[0];
    const content = choice?.message?.content ?? "";

    return {
      ok: true,
      data: {
        id: response.id,
        model: response.model ?? config.model,
        content,
        choices: response.choices,
        usage: response.usage,
        finish_reason: choice?.finish_reason,
      },
      latency_ms: latencyMs,
    } satisfies ToolOk;
  } catch (error) {
    return mapOpenAiError(error);
  }
}

export interface DefaultToolInvokerOptions extends CreateMcpRegistryOptions {
  enableRemoteMcp?: boolean;
  mcpClientPromise?: Promise<MCPClient | null>;
}

export function createDefaultToolInvoker(options: DefaultToolInvokerOptions = {}): ToolInvoker {
  const mcpRegistry = createMcpRegistry(options);
  const enableRemote = options.enableRemoteMcp ?? true;

  const mcpClientPromise: Promise<MCPClient | null> = enableRemote
    ? (options.mcpClientPromise ??
      createMCPClient()
        .then((client) => client)
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`failed to initialise MCP client: ${message}`);
          return null;
        }))
    : Promise.resolve(null);

  return async (call: ToolCall, ctx: ToolContext) => {
    const localResult = await mcpRegistry.invoke(call, ctx);
    if (localResult !== null) {
      return localResult;
    }

    if (enableRemote) {
      const client = await mcpClientPromise;
      if (client?.isAvailable()) {
        const route = resolveMcpRoute(client, call.name);
        if (route) {
          const remoteResult = await client.invoke(route.serverId, route.toolName, call.args, {
            traceId: ctx?.trace_id,
          });
          if (remoteResult.ok || !isToolNotFoundError(remoteResult)) {
            return remoteResult;
          }
        }
      }
    }

    return invokeLocalTool(call);
  };
}

async function invokeLocalTool(call: ToolCall): Promise<ToolResult> {
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
}

function resolveMcpRoute(
  client: MCPClient,
  toolName: string,
): { serverId: string; toolName: string } | null {
  const trimmed = toolName.trim();
  if (!trimmed) {
    return null;
  }
  const firstDot = trimmed.indexOf(".");
  if (firstDot > 0) {
    const serverId = trimmed.slice(0, firstDot);
    const innerTool = trimmed.slice(firstDot + 1);
    if (innerTool && client.hasServer(serverId)) {
      return { serverId, toolName: innerTool };
    }
  }
  const defaultServer = client.getDefaultServer();
  if (defaultServer) {
    return { serverId: defaultServer, toolName: trimmed };
  }
  return null;
}

function isToolNotFoundError(result: ToolResult): boolean {
  if (result.ok) {
    return false;
  }
  return result.code === "tool.not_found" || result.code === "mcp.tool_not_found";
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
  private readonly plannerInstruction =
    "你是一名善于拆解任务的规划助手，需要把复杂目标分解为一系列可以调用工具或 MCP 能力的步骤。";

  constructor(private readonly options: ChatKernelOptions) {
    const baseHistory = Array.isArray(options.history)
      ? options.history.map((msg) => ({ role: msg.role, content: msg.content }))
      : [];

    const filteredHistory = baseHistory.filter(
      (msg) =>
        !(msg.role === DEFAULT_SYSTEM_PROMPT.role && msg.content === DEFAULT_SYSTEM_PROMPT.content),
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
    const buildFallbackPlan = (notes?: string[]): Plan => {
      const fallbackStep: PlanStep = {
        id: `${this.options.traceId}-r${revision}-s1`,
        op: "llm.chat",
        args: { messages: combinedHistory },
        description: "fallback chat response",
      } satisfies PlanStep;
      this.stepRevision.set(fallbackStep.id, revision);
      return {
        revision,
        reason: "fallback",
        notes: notes && notes.length ? notes : undefined,
        steps: [fallbackStep],
      } satisfies Plan;
    };

    const planMessages = this.buildPlanningMessages(combinedHistory);

    let plannerResult: ToolResult | undefined;
    try {
      plannerResult = await this.options.toolInvoker(
        { name: "llm.chat", args: { messages: planMessages, temperature: 0 } },
        { trace_id: this.options.traceId, span_id: `plan-${revision}` },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return buildFallbackPlan([`plan invocation failed: ${message}`]);
    }

    if (!plannerResult?.ok) {
      const note =
        plannerResult?.message && typeof plannerResult.message === "string"
          ? plannerResult.message
          : "plan invocation error";
      return buildFallbackPlan([note]);
    }

    const parsed = this.parsePlanResult(plannerResult.data, revision, combinedHistory);
    if (!parsed.steps.length) {
      return buildFallbackPlan(parsed.notes);
    }

    const steps = parsed.steps.map((step) => {
      this.stepRevision.set(step.id, revision);
      return step;
    });

    return {
      revision,
      reason: parsed.reason ?? (revision === 1 ? "initial" : "retry"),
      notes: parsed.notes,
      steps,
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

    if (this.isAskStep(step) || step.op === "ask.user" || step.op === "ask") {
      const askData = this.buildAsk(step);
      const ask: AskRequest = {
        question: askData.question || "请补充更多信息",
        origin_step: askData.origin_step,
        detail: askData.detail,
      } satisfies AskRequest;
      return makeAskOutcome(ask);
    }

    const revision = this.stepRevision.get(step.id);
    const context = {
      trace_id: this.options.traceId,
      span_id: step.id,
      ...(revision ? { metadata: { revision } } : {}),
    };

    const call = this.resolveToolCall(step);

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
        `等待用户补充信息：${asks.map((ask) => ask.ask?.question ?? ask.step.id).join("; ")}`,
      );
    }

    for (const failure of failures) {
      const message = failure.result.ok ? "" : (failure.result.message ?? "unknown error");
      notes.push(`步骤 ${failure.step.id} 失败：${message}`);
    }

    const previousFailures = actions.filter(
      (action) => this.stepRevision.get(action.step.id) !== revision && !action.result.ok,
    );
    if (previousFailures.length > 0) {
      notes.push(`历史失败步骤：${previousFailures.map((item) => item.step.id).join(", ")}`);
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

  private buildPlanningMessages(combinedHistory: ChatMessage[]): ChatMessage[] {
    const conversation = combinedHistory
      .filter(
        (msg) =>
          !(
            msg.role === DEFAULT_SYSTEM_PROMPT.role && msg.content === DEFAULT_SYSTEM_PROMPT.content
          ),
      )
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
      "支持的 op 可以是 llm.chat、echo、http.get、file.read、mcp-core.* 或其他注册工具。输出必须是 JSON 对象或数组，必要时可包含 reason、notes。",
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
    combinedHistory: ChatMessage[],
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
      ? (parsed.notes as unknown[]).filter((note): note is string => typeof note === "string")
      : undefined;

    const steps: PlanStep[] = [];
    for (const [index, item] of stepsInput.entries()) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const op = typeof (item as any).op === "string" ? (item as any).op.trim() : "";
      if (!op) {
        continue;
      }
      const idRaw = (item as any).id;
      const id =
        typeof idRaw === "string" && idRaw.trim()
          ? idRaw.trim()
          : `${this.options.traceId}-step-${revision}-${index + 1}`;
      const rawArgs = (item as any).args;
      const args = rawArgs && typeof rawArgs === "object" ? { ...rawArgs } : {};
      if (
        op === "llm.chat" &&
        !Array.isArray((args as any).messages) &&
        typeof (args as any).prompt !== "string"
      ) {
        (args as any).messages = combinedHistory;
      }
      const description =
        typeof (item as any).description === "string" ? (item as any).description : undefined;
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
    const op = step.op?.toLowerCase();
    return op === "agent.ask" || op === "agent.request_clarification";
  }

  private buildAsk(step: PlanStep): { question: string; origin_step: string; detail?: any } {
    const args = step.args ?? {};
    const question =
      typeof (args as any)?.question === "string"
        ? (args as any).question
        : (this.options.message ?? "请补充更多信息");
    const detail = (args as any)?.detail;
    return { question, origin_step: step.id, detail };
  }

  private resolveToolCall(step: PlanStep): ToolCall | null {
    const op = typeof step.op === "string" ? step.op.trim() : "";
    if (!op) {
      return null;
    }

    // Handle direct mcp.invoke calls
    if (op === "mcp.invoke") {
      return { name: op, args: step.args ?? {} } satisfies ToolCall;
    }

    // Handle local.* prefixed operations
    if (op.startsWith("local.")) {
      return { name: op.slice("local.".length), args: step.args ?? {} } satisfies ToolCall;
    }

    // Handle MCP operation formats (mcp://, mcp-*, mcp.*)
    const mcpSpec = this.parseMcpOperation(op);
    if (mcpSpec) {
      const args = step.args ?? {};
      if (
        args &&
        typeof args === "object" &&
        "server" in (args as any) &&
        "tool" in (args as any)
      ) {
        return { name: "mcp.invoke", args } satisfies ToolCall;
      }
      return {
        name: "mcp.invoke",
        args: {
          server: mcpSpec.server,
          tool: mcpSpec.tool,
          params: args,
          input: args,
        },
      } satisfies ToolCall;
    }

    // Default fallback - pass through as regular tool call
    // This allows the tool invoker to handle unknown MCP operations
    return { name: op, args: step.args ?? {} } satisfies ToolCall;
  }

  private parseMcpOperation(op: string): { server: string; tool: string } | null {
    if (!op.startsWith("mcp")) {
      return null;
    }

    if (op.startsWith("mcp://")) {
      const remainder = op.slice("mcp://".length);
      const slash = remainder.indexOf("/");
      if (slash <= 0) {
        return null;
      }
      const server = remainder.slice(0, slash);
      const tool = remainder.slice(slash + 1);
      return tool ? { server, tool } : null;
    }

    if (op.startsWith("mcp-")) {
      const dot = op.indexOf(".");
      if (dot <= 0) {
        return null;
      }
      const server = op.slice(0, dot);
      const tool = op.slice(dot + 1);
      return tool ? { server, tool } : null;
    }

    if (op.startsWith("mcp.")) {
      const remainder = op.slice("mcp.".length);
      const dot = remainder.indexOf(".");
      if (dot <= 0) {
        return null;
      }
      const server = remainder.slice(0, dot);
      const tool = remainder.slice(dot + 1);
      return tool ? { server, tool } : null;
    }

    const dotIndex = op.indexOf(".");
    if (dotIndex <= 0) {
      return null;
    }
    const server = op.slice(0, dotIndex);
    const tool = op.slice(dotIndex + 1);
    return tool ? { server, tool } : null;
  }
}

export function createChatKernel(options: ChatKernelOptions): AgentKernel {
  return new ChatKernel(options);
}

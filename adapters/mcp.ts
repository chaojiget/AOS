import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { ToolCall, ToolContext, ToolError, ToolOk, ToolResult } from "../core/agent";
import type { EventBus, EventEnvelope } from "../runtime/events";
import { createCoreMcpServer, type McpCoreServerOptions } from "../servers/mcp-core";

export type MCPTransport = "http" | "ws" | "stdio";

export interface MCPServerConfig {
  id: string;
  transport: MCPTransport;
  url?: string;
  cmd?: string;
  args?: string[];
  env?: Record<string, string>;
  default?: boolean;
}

export interface MCPRegistry {
  servers: MCPServerConfig[];
  defaultServer?: string;
}

export interface MCPToolSummary {
  name: string;
  description?: string;
  schema?: any;
}

export interface MCPResourceSummary {
  uri: string;
  mime?: string;
  description?: string;
}

export interface MCPInvokeOptions {
  traceId?: string;
  trace_id?: string;
}

export interface MCPClientOptions {
  registryPath?: string;
  replayTraceId?: string;
  replayDir?: string;
  fetchImpl?: typeof fetch;
}

export interface MCPClient {
  isAvailable(): boolean;
  hasServer(id: string): boolean;
  getDefaultServer(): string | undefined;
  tools(serverId?: string): Promise<MCPToolSummary[]>;
  listTools(serverId?: string): Promise<MCPToolSummary[]>;
  resources(serverId?: string): Promise<MCPResourceSummary[]>;
  listResources(serverId?: string): Promise<MCPResourceSummary[]>;
  invoke(serverId: string, tool: string, args: any, options?: MCPInvokeOptions): Promise<ToolResult>;
  close(): Promise<void>;
}

interface MCPTransportOk {
  ok: true;
  data: any;
  cost?: number;
  latency_ms?: number;
}

interface MCPTransportError {
  ok: false;
  code: string;
  message: string;
  retryable?: boolean;
}

type MCPTransportResult = MCPTransportOk | MCPTransportError;

class MCPConnectionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

class MCPServerError extends Error {
  constructor(message: string, public readonly data: any) {
    super(message);
    this.name = "MCPServerError";
  }
}

interface MCPServerConnection {
  listTools(): Promise<MCPToolSummary[]>;
  listResources(): Promise<MCPResourceSummary[]>;
  invoke(tool: string, args: any, options?: MCPInvokeOptions): Promise<MCPTransportResult>;
  close(): Promise<void>;
}

function normaliseObject(value: Record<string, unknown>): Record<string, string> {
  const entries = Object.entries(value).map(([key, val]) => [key, String(val)] as const);
  return Object.fromEntries(entries);
}

function isHttpServerConfig(config: MCPServerConfig): config is MCPServerConfig & { url: string } {
  return config.transport === "http" && typeof config.url === "string" && config.url.length > 0;
}

function isWsServerConfig(config: MCPServerConfig): config is MCPServerConfig & { url: string } {
  return config.transport === "ws" && typeof config.url === "string" && config.url.length > 0;
}

function isStdioServerConfig(config: MCPServerConfig): config is MCPServerConfig & { cmd: string } {
  return config.transport === "stdio" && typeof config.cmd === "string" && config.cmd.length > 0;
}

function stableStringify(value: any): string {
  return JSON.stringify(value, (_, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.keys(val)
        .sort()
        .reduce((acc, key) => {
          acc[key] = val[key];
          return acc;
        }, {} as Record<string, any>);
    }
    return val;
  });
}

export function computeArgsHash(args: any): string {
  const hash = createHash("sha256");
  hash.update(stableStringify(args ?? null));
  return hash.digest("hex");
}

class ReplayStore {
  private ready: Promise<void> | null = null;
  private readonly results = new Map<string, ToolResult>();

  constructor(private readonly options: { traceId: string; dir?: string }) {}

  private key(server: string, tool: string, hash: string): string {
    return `${server}::${tool}::${hash}`;
  }

  private async load() {
    try {
      const module = await import("../runtime/replay");
      const events = await module.replayEpisode(this.options.traceId, { dir: this.options.dir });
      for (const event of events) {
        if (event.type !== "mcp.result") continue;
        const data = event.data as any;
        if (!data || typeof data !== "object") continue;
        const server = typeof data.server === "string" ? data.server : undefined;
        const tool = typeof data.tool === "string" ? data.tool : undefined;
        const argsHash = typeof data.args_hash === "string" ? data.args_hash : undefined;
        if (!server || !tool || !argsHash) continue;
        const payload = (data.result ?? data.data ?? data) as any;
        if (data.ok === true || payload?.ok === true) {
          const ok: ToolOk = {
            ok: true,
            data: payload?.data ?? data.data ?? null,
            cost: typeof data.cost === "number" ? data.cost : payload?.cost,
            latency_ms:
              typeof data.latency_ms === "number"
                ? data.latency_ms
                : typeof payload?.latency_ms === "number"
                  ? payload.latency_ms
                  : undefined,
          };
          this.results.set(this.key(server, tool, argsHash), ok);
        } else if (data.ok === false || payload?.ok === false) {
          const errorPayload = payload?.error ?? payload;
          const error: ToolError = {
            ok: false,
            code:
              typeof data.code === "string"
                ? data.code
                : typeof errorPayload?.code === "string"
                  ? errorPayload.code
                  : "mcp.error",
            message:
              typeof data.message === "string"
                ? data.message
                : typeof errorPayload?.message === "string"
                  ? errorPayload.message
                  : "MCP replay error",
            retryable:
              typeof data.retryable === "boolean"
                ? data.retryable
                : typeof errorPayload?.retryable === "boolean"
                  ? errorPayload.retryable
                  : undefined,
          };
          this.results.set(this.key(server, tool, argsHash), error);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/episode not found/i.test(message)) {
        throw error;
      }
    }
  }

  private async ensureReady() {
    if (!this.ready) {
      this.ready = this.load();
    }
    await this.ready;
  }

  async match(server: string, tool: string, args: any): Promise<ToolResult | undefined> {
    await this.ensureReady();
    const hash = computeArgsHash(args);
    return this.results.get(this.key(server, tool, hash));
  }
}

class HttpMCPConnection implements MCPServerConnection {
  private nextId = 0;

  constructor(private readonly config: MCPServerConfig & { url: string }, private readonly fetchImpl: typeof fetch) {}

  private async request(method: string, params: any = {}): Promise<any> {
    const id = `rpc-${++this.nextId}`;
    let response: Response;
    const compatibility: Record<string, any> = {};
    if (params && typeof params === "object") {
      if ("arguments" in params) {
        compatibility.args = (params as any).arguments;
      }
      if (typeof (params as any).context?.trace_id === "string") {
        compatibility.trace_id = (params as any).context.trace_id;
      }
    }

    try {
      response = await this.fetchImpl(this.config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params, ...compatibility }),
      });
    } catch (error) {
      throw new MCPConnectionError(
        "network_error",
        error instanceof Error ? error.message : "network request failed",
      );
    }

    let text = "";
    try {
      text = await response.text();
    } catch (error) {
      throw new MCPConnectionError(
        "invalid_response",
        error instanceof Error ? error.message : "failed to read MCP response",
      );
    }

    let payload: any = undefined;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        throw new MCPConnectionError(
          "invalid_response",
          error instanceof Error ? error.message : "failed to parse MCP response",
        );
      }
    } else {
      payload = undefined;
    }

    if (!response.ok) {
      const message =
        typeof payload?.error?.message === "string"
          ? payload.error.message
          : `MCP HTTP error (${response.status})`;
      throw new MCPConnectionError("http_error", message);
    }

    if (!payload || typeof payload !== "object") {
      throw new MCPConnectionError("invalid_response", "empty MCP response payload");
    }

    if (payload.error) {
      throw new MCPServerError(
        typeof payload.error.message === "string" ? payload.error.message : "MCP server error",
        payload.error,
      );
    }

    return payload.result ?? payload;
  }

  async listTools(): Promise<MCPToolSummary[]> {
    const result = await this.request("tools/list");
    const tools = Array.isArray(result?.tools) ? result.tools : [];
    return tools.map((item: any) => ({
      name: String(item?.name ?? ""),
      description: typeof item?.description === "string" ? item.description : undefined,
      schema: item?.schema,
    }));
  }

  async listResources(): Promise<MCPResourceSummary[]> {
    const result = await this.request("resources/list");
    const resources = Array.isArray(result?.resources) ? result.resources : [];
    return resources.map((item: any) => ({
      uri: String(item?.uri ?? ""),
      mime: typeof item?.mime === "string" ? item.mime : undefined,
      description: typeof item?.description === "string" ? item.description : undefined,
    }));
  }

  async invoke(tool: string, args: any, options?: MCPInvokeOptions): Promise<MCPTransportResult> {
    const traceId = options?.traceId ?? options?.trace_id;
    try {
      const result = await this.request("tools/call", {
        name: tool,
        arguments: args,
        context: traceId ? { trace_id: traceId } : undefined,
      });

      if (result && typeof result.ok === "boolean") {
        if (result.ok) {
          return {
            ok: true,
            data: result.data,
            cost: typeof result.cost === "number" ? result.cost : undefined,
            latency_ms:
              typeof result.latency_ms === "number" ? result.latency_ms : undefined,
          } satisfies MCPTransportOk;
        }
        const errorDetail = result.error ?? result;
        return {
          ok: false,
          code: typeof errorDetail?.code === "string" ? errorDetail.code : "mcp.invoke_error",
          message:
            typeof errorDetail?.message === "string"
              ? errorDetail.message
              : "MCP invocation failed",
          retryable:
            typeof errorDetail?.retryable === "boolean" ? errorDetail.retryable : undefined,
        } satisfies MCPTransportError;
      }

      return {
        ok: false,
        code: "mcp.invalid_response",
        message: "MCP response missing ok flag",
      } satisfies MCPTransportError;
    } catch (error) {
      if (error instanceof MCPServerError) {
        const detail = error.data ?? {};
        return {
          ok: false,
          code: typeof detail.code === "string" ? detail.code : "mcp.server_error",
          message:
            typeof detail.message === "string" ? detail.message : error.message ?? "MCP server error",
          retryable: typeof detail.retryable === "boolean" ? detail.retryable : undefined,
        } satisfies MCPTransportError;
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    // HTTP connections are stateless; nothing to dispose.
  }
}

class WebSocketMCPConnection implements MCPServerConnection {
  private socket: WebSocket | null = null;
  private pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private nextId = 0;
  private connecting: Promise<void> | null = null;

  constructor(private readonly config: MCPServerConfig & { url: string }) {}

  private async ensureSocket(): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }

    if (!this.connecting) {
      if (typeof WebSocket === "undefined") {
        throw new MCPConnectionError("unsupported", "WebSocket is not available in this runtime");
      }
      this.connecting = new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(this.config.url);
        const onOpen = () => {
          cleanup();
          this.socket = socket;
          socket.addEventListener("message", (event) => {
            this.handleMessage(event.data);
          });
          socket.addEventListener("close", () => {
            this.rejectAll(new MCPConnectionError("connection_closed", "WebSocket closed"));
            this.socket = null;
          });
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new MCPConnectionError("network_error", "WebSocket connection failed"));
        };
        const cleanup = () => {
          socket.removeEventListener("open", onOpen);
          socket.removeEventListener("error", onError);
        };
        socket.addEventListener("open", onOpen);
        socket.addEventListener("error", onError);
      });
    }
    await this.connecting;
  }

  private rejectAll(error: Error) {
    for (const entry of this.pending.values()) {
      entry.reject(error);
    }
    this.pending.clear();
  }

  private handleMessage(data: any) {
    let text: string | null = null;
    if (typeof data === "string") {
      text = data;
    } else if (data instanceof ArrayBuffer) {
      text = new TextDecoder().decode(data);
    }
    if (!text) return;
    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      return;
    }
    const id = payload?.id;
    if (!id) return;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    pending.resolve(payload);
  }

  private async send(message: Record<string, any>): Promise<any> {
    await this.ensureSocket();
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new MCPConnectionError("network_error", "WebSocket is not open");
    }
    const id = message.id ?? `req-${++this.nextId}`;
    const payload = JSON.stringify({ ...message, id });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        socket.send(payload);
      } catch (error) {
        this.pending.delete(id);
        reject(
          new MCPConnectionError(
            "network_error",
            error instanceof Error ? error.message : "failed to send WebSocket message",
          ),
        );
      }
    });
  }

  async listTools(): Promise<MCPToolSummary[]> {
    const response = await this.send({ type: "tools" });
    const tools = Array.isArray(response?.tools)
      ? response.tools
      : Array.isArray(response?.result?.tools)
        ? response.result.tools
        : [];
    return tools.map((item: any) => ({
      name: String(item?.name ?? ""),
      description: typeof item?.description === "string" ? item.description : undefined,
      schema: item?.schema,
    }));
  }

  async listResources(): Promise<MCPResourceSummary[]> {
    const response = await this.send({ type: "resources" });
    const resources = Array.isArray(response?.resources)
      ? response.resources
      : Array.isArray(response?.result?.resources)
        ? response.result.resources
        : [];
    return resources.map((item: any) => ({
      uri: String(item?.uri ?? ""),
      mime: typeof item?.mime === "string" ? item.mime : undefined,
      description: typeof item?.description === "string" ? item.description : undefined,
    }));
  }

  async invoke(tool: string, args: any, options?: MCPInvokeOptions): Promise<MCPTransportResult> {
    const traceId = options?.traceId ?? options?.trace_id;
    const response = await this.send({ type: "invoke", tool, args, trace_id: traceId });
    const result = response?.result ?? response;
    if (result && typeof result.ok === "boolean") {
      if (result.ok) {
        return {
          ok: true,
          data: result.data,
          cost: typeof result.cost === "number" ? result.cost : undefined,
          latency_ms:
            typeof result.latency_ms === "number" ? result.latency_ms : undefined,
        } satisfies MCPTransportOk;
      }
      const error = result.error ?? result;
      return {
        ok: false,
        code: typeof error?.code === "string" ? error.code : "mcp.invoke_error",
        message: typeof error?.message === "string" ? error.message : "MCP invocation failed",
        retryable: typeof error?.retryable === "boolean" ? error.retryable : undefined,
      } satisfies MCPTransportError;
    }
    return { ok: true, data: result } satisfies MCPTransportOk;
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    this.connecting = null;
    if (!socket) {
      this.rejectAll(new MCPConnectionError("connection_closed", "WebSocket closed"));
      return;
    }

    await new Promise<void>((resolve) => {
      const finish = () => {
        socket.removeEventListener("close", finish);
        socket.removeEventListener("error", finish);
        resolve();
      };
      socket.addEventListener("close", finish);
      socket.addEventListener("error", finish);
      try {
        socket.close();
      } catch {
        resolve();
      }
      const timer: ReturnType<typeof setTimeout> = setTimeout(resolve, 100);
      if (typeof (timer as any)?.unref === "function") {
        (timer as any).unref();
      }
    });

    this.rejectAll(new MCPConnectionError("connection_closed", "WebSocket closed"));
  }
}

class StdioMCPConnection implements MCPServerConnection {
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly rl: ReturnType<typeof createInterface>;
  private readonly pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private nextId = 0;
  private closed = false;

  constructor(private readonly config: MCPServerConfig & { cmd: string }) {
    this.proc = spawn(this.config.cmd, this.config.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: this.config.env ? { ...process.env, ...normaliseObject(this.config.env) } : process.env,
    });

    this.proc.stderr?.setEncoding("utf8");
    this.proc.stderr?.on("data", () => {});

    this.proc.on("error", (error) => {
      this.closed = true;
      this.rejectAll(
        new MCPConnectionError(
          "spawn_error",
          error instanceof Error ? error.message : "failed to start MCP stdio server",
        ),
      );
    });

    this.proc.on("close", (code, signal) => {
      this.closed = true;
      const detail =
        typeof code === "number"
          ? ` (code ${code})`
          : signal
            ? ` (signal ${signal})`
            : "";
      this.rejectAll(new MCPConnectionError("process_exit", `MCP stdio server exited${detail}`));
    });

    this.rl = createInterface({ input: this.proc.stdout });
    this.rl.on("line", (line: string) => {
      let payload: any;
      try {
        payload = JSON.parse(line);
      } catch {
        return;
      }
      const id = payload?.id;
      if (!id) return;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      pending.resolve(payload);
    });
  }

  private rejectAll(error: Error) {
    for (const entry of this.pending.values()) {
      entry.reject(error);
    }
    this.pending.clear();
  }

  private async send(message: Record<string, any>): Promise<any> {
    if (this.closed) {
      throw new MCPConnectionError("process_exit", "MCP stdio server is not running");
    }
    const id = message.id ?? `req-${++this.nextId}`;
    const payload = JSON.stringify({ ...message, id });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(`${payload}\n`, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(new MCPConnectionError("io_error", error.message));
        }
      });
    });
  }

  async listTools(): Promise<MCPToolSummary[]> {
    const response = await this.send({ type: "tools" });
    const tools = Array.isArray(response?.tools)
      ? response.tools
      : Array.isArray(response?.result?.tools)
        ? response.result.tools
        : [];
    return tools.map((item: any) => ({
      name: String(item?.name ?? ""),
      description: typeof item?.description === "string" ? item.description : undefined,
      schema: item?.schema,
    }));
  }

  async listResources(): Promise<MCPResourceSummary[]> {
    const response = await this.send({ type: "resources" });
    const resources = Array.isArray(response?.resources)
      ? response.resources
      : Array.isArray(response?.result?.resources)
        ? response.result.resources
        : [];
    return resources.map((item: any) => ({
      uri: String(item?.uri ?? ""),
      mime: typeof item?.mime === "string" ? item.mime : undefined,
      description: typeof item?.description === "string" ? item.description : undefined,
    }));
  }

  async invoke(tool: string, args: any, options?: MCPInvokeOptions): Promise<MCPTransportResult> {
    const traceId = options?.traceId ?? options?.trace_id;
    const response = await this.send({ type: "invoke", tool, args, trace_id: traceId });
    const result = response?.result ?? response;
    if (result && typeof result.ok === "boolean") {
      if (result.ok) {
        return {
          ok: true,
          data: result.data,
          cost: typeof result.cost === "number" ? result.cost : undefined,
          latency_ms:
            typeof result.latency_ms === "number" ? result.latency_ms : undefined,
        } satisfies MCPTransportOk;
      }
      const error = result.error ?? result;
      return {
        ok: false,
        code: typeof error?.code === "string" ? error.code : "mcp.invoke_error",
        message: typeof error?.message === "string" ? error.message : "MCP invocation failed",
        retryable: typeof error?.retryable === "boolean" ? error.retryable : undefined,
      } satisfies MCPTransportError;
    }
    return { ok: true, data: result } satisfies MCPTransportOk;
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.rejectAll(new MCPConnectionError("process_exit", "MCP stdio server closed"));
    try {
      this.rl.removeAllListeners();
      this.rl.close();
    } catch {
      // ignore readline cleanup errors
    }
    try {
      this.proc.removeAllListeners();
      this.proc.stdin.end();
    } catch {
      // ignore
    }
    try {
      this.proc.kill("SIGTERM");
    } catch {
      // ignore kill errors
    }
  }
}

class MCPClientImpl implements MCPClient {
  constructor(
    private readonly connections: Map<string, MCPServerConnection>,
    private readonly defaultServerId: string | undefined,
    private readonly replay?: ReplayStore,
  ) {}

  isAvailable(): boolean {
    return this.connections.size > 0;
  }

  hasServer(id: string): boolean {
    return this.connections.has(id);
  }

  getDefaultServer(): string | undefined {
    return this.defaultServerId;
  }

  async tools(serverId?: string): Promise<MCPToolSummary[]> {
    const target = serverId ?? this.defaultServerId;
    if (!target) return [];
    const connection = this.connections.get(target);
    if (!connection) return [];
    return connection.listTools();
  }

  async listTools(serverId?: string): Promise<MCPToolSummary[]> {
    return this.tools(serverId);
  }

  async resources(serverId?: string): Promise<MCPResourceSummary[]> {
    const target = serverId ?? this.defaultServerId;
    if (!target) return [];
    const connection = this.connections.get(target);
    if (!connection) return [];
    return connection.listResources();
  }

  async listResources(serverId?: string): Promise<MCPResourceSummary[]> {
    return this.resources(serverId);
  }

  async invoke(serverId: string, tool: string, args: any, options?: MCPInvokeOptions): Promise<ToolResult> {
    const connection = this.connections.get(serverId);
    if (!connection) {
      return {
        ok: false,
        code: "mcp.server_not_found",
        message: `MCP server ${serverId} is not registered`,
      } satisfies ToolError;
    }

    if (this.replay) {
      const replayed = await this.replay.match(serverId, tool, args);
      if (replayed) {
        if (replayed.ok && replayed.latency_ms == null) {
          return { ...replayed, latency_ms: 0 } satisfies ToolOk;
        }
        return replayed;
      }
    }

    const started = Date.now();
    try {
      const result = await connection.invoke(tool, args, options);
      if (result.ok) {
        return {
          ok: true,
          data: result.data,
          cost: result.cost,
          latency_ms:
            typeof result.latency_ms === "number" ? result.latency_ms : Date.now() - started,
        } satisfies ToolOk;
      }
      return {
        ok: false,
        code: result.code,
        message: result.message,
        retryable: result.retryable,
      } satisfies ToolError;
    } catch (error) {
      if (error instanceof MCPConnectionError) {
        const code = error.code.startsWith("mcp.") ? error.code : `mcp.${error.code}`;
        const retryable = error.code === "network_error" || error.code === "timeout";
        return {
          ok: false,
          code,
          message: error.message,
          retryable,
        } satisfies ToolError;
      }
      const message = error instanceof Error ? error.message : "unknown MCP error";
      return {
        ok: false,
        code: "mcp.internal_error",
        message,
      } satisfies ToolError;
    }
  }

  async close(): Promise<void> {
    const closures: Promise<void>[] = [];
    for (const connection of this.connections.values()) {
      try {
        const result = connection.close();
        closures.push(Promise.resolve(result));
      } catch {
        // Ignore connection close errors.
      }
    }
    this.connections.clear();
    if (closures.length > 0) {
      await Promise.allSettled(closures);
    }
  }
}

export async function loadMCPRegistry(registryPath?: string): Promise<MCPRegistry> {
  const envRegistryPath = process.env.MCP_REGISTRY_PATH ?? process.env.AOS_MCP_REGISTRY;
  const resolvedPath = registryPath ?? envRegistryPath ?? join(process.cwd(), "mcp.registry.json");

  let content: string;
  try {
    content = await readFile(resolvedPath, "utf8");
  } catch (error: any) {
    if (error && error.code === "ENOENT") {
      return { servers: [] };
    }
    throw new Error(
      `failed to read MCP registry at ${resolvedPath}: ${error instanceof Error ? error.message : error}`,
    );
  }

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `failed to parse MCP registry at ${resolvedPath}: ${error instanceof Error ? error.message : error}`,
    );
  }

  const rawServers = Array.isArray(parsed?.servers)
    ? parsed.servers
    : Array.isArray(parsed)
      ? parsed
      : [];
  const servers: MCPServerConfig[] = [];
  for (const item of rawServers) {
    if (!item || typeof item.id !== "string" || typeof item.transport !== "string") {
      continue;
    }
    const transport = item.transport.toLowerCase();
    if (transport !== "http" && transport !== "ws" && transport !== "stdio") {
      continue;
    }
    const server: MCPServerConfig = {
      id: item.id,
      transport,
      url: typeof item.url === "string" ? item.url : undefined,
      cmd: typeof item.cmd === "string" ? item.cmd : undefined,
      args: Array.isArray(item.args) ? item.args.map((arg: any) => String(arg)) : undefined,
      env:
        item.env && typeof item.env === "object" ? normaliseObject(item.env as Record<string, unknown>) : undefined,
      default: Boolean(item.default),
    };
    servers.push(server);
  }

  const defaultServer = servers.find((server) => server.default)?.id;
  return { servers, defaultServer };
}

export async function createMCPClient(options: MCPClientOptions = {}): Promise<MCPClient | null> {
  const registry = await loadMCPRegistry(options.registryPath);
  if (registry.servers.length === 0) {
    return null;
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const connections = new Map<string, MCPServerConnection>();

  for (const server of registry.servers) {
    try {
      if (isHttpServerConfig(server)) {
        connections.set(server.id, new HttpMCPConnection(server, fetchImpl));
      } else if (isWsServerConfig(server)) {
        connections.set(server.id, new WebSocketMCPConnection(server));
      } else if (isStdioServerConfig(server)) {
        connections.set(server.id, new StdioMCPConnection(server));
      }
    } catch (error) {
      // Skip servers that fail to initialise.
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`failed to initialise MCP server ${server.id}: ${message}`);
    }
  }

  if (connections.size === 0) {
    return null;
  }

  const defaultFromRegistry = registry.defaultServer;
  const defaultServer =
    defaultFromRegistry && connections.has(defaultFromRegistry)
      ? defaultFromRegistry
      : Array.from(connections.keys())[0];

  const replayTraceId = options.replayTraceId ?? process.env.AOS_REPLAY_TRACE_ID;
  const replayDir = options.replayDir ?? process.env.AOS_REPLAY_DIR;
  const replay = replayTraceId ? new ReplayStore({ traceId: replayTraceId, dir: replayDir }) : undefined;

  return new MCPClientImpl(connections, defaultServer, replay);
}

// ---------------------------------------------------------------------------
// Legacy registry + adapter APIs used by local tool invocation
// ---------------------------------------------------------------------------

export type McpMode = "record" | "replay";

export interface CreateMcpRegistryOptions {
  workspaceRoot?: string;
  eventBus?: EventBus;
  mode?: McpMode;
  replayState?: Map<string, ToolResult>;
}

interface RegisteredTool {
  serverId: string;
  handler: (args: any, ctx: ToolContext) => Promise<ToolResult>;
}

function cloneResult<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildReplayKey(serverId: string, toolName: string, args: unknown): string {
  return JSON.stringify({ server: serverId, tool: toolName, args });
}

function publishEvent(bus: EventBus | undefined, envelope: EventEnvelope): Promise<EventEnvelope | void> {
  if (!bus) {
    return Promise.resolve();
  }
  const enriched: EventEnvelope = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    version: 1,
    ...envelope,
  };
  return bus.publish(enriched);
}

function cloneToolResult(result: ToolResult): ToolResult {
  return cloneResult(result);
}

export interface McpRegistry {
  hasTool(name: string): boolean;
  invoke(call: ToolCall, ctx: ToolContext): Promise<ToolResult | null>;
}

export function createMcpRegistry(options: CreateMcpRegistryOptions = {}): McpRegistry {
  const server = createCoreMcpServer({ root: options.workspaceRoot });
  const tools = new Map<string, RegisteredTool>();
  const servers = [server];
  for (const srv of servers) {
    for (const [name, handler] of Object.entries(srv.tools)) {
      tools.set(name, { serverId: srv.id, handler });
    }
  }

  const mode: McpMode = options.mode ?? "record";
  const replayState = options.replayState ?? new Map<string, ToolResult>();

  return {
    hasTool(name: string): boolean {
      return tools.has(name);
    },

    async invoke(call: ToolCall, ctx: ToolContext): Promise<ToolResult | null> {
      const entry = tools.get(call.name);
      if (!entry) {
        return null;
      }

      const args = call.args ?? {};
      const key = buildReplayKey(entry.serverId, call.name, args);

      await publishEvent(options.eventBus, {
        type: "mcp.call",
        trace_id: ctx.trace_id,
        span_id: ctx.span_id,
        data: {
          server: entry.serverId,
          tool: call.name,
          args,
        },
      });

      if (mode === "replay") {
        const recorded = replayState.get(key);
        if (!recorded) {
          const error: ToolError = {
            ok: false,
            code: "mcp.replay_missing",
            message: `no recorded result for ${call.name}`,
          };
          await publishEvent(options.eventBus, {
            type: "mcp.result",
            trace_id: ctx.trace_id,
            span_id: ctx.span_id,
            data: {
              server: entry.serverId,
              tool: call.name,
              ok: false,
              error: error.message,
            },
          });
          return error;
        }
        const cloned = cloneToolResult(recorded);
        await publishEvent(options.eventBus, {
          type: "mcp.result",
          trace_id: ctx.trace_id,
          span_id: ctx.span_id,
          data: {
            server: entry.serverId,
            tool: call.name,
            ok: cloned.ok,
            bytes:
              cloned.ok && typeof (cloned.data as any)?.bytes === "number"
                ? (cloned.data as any).bytes
                : undefined,
            path:
              cloned.ok && typeof (cloned.data as any)?.path === "string"
                ? (cloned.data as any).path
                : undefined,
            result: cloned,
          },
        });
        return cloneResult(cloned);
      }

      const result = await entry.handler(args, ctx);
      replayState.set(key, cloneToolResult(result));
      await publishEvent(options.eventBus, {
        type: "mcp.result",
        trace_id: ctx.trace_id,
        span_id: ctx.span_id,
        data: {
          server: entry.serverId,
          tool: call.name,
          ok: result.ok,
          bytes:
            result.ok && typeof (result.data as any)?.bytes === "number"
              ? (result.data as any).bytes
              : undefined,
          path:
            result.ok && typeof (result.data as any)?.path === "string"
              ? (result.data as any).path
              : undefined,
          result,
        },
      });
      return result;
    },
  } satisfies McpRegistry;
}

export type McpAdapterMode = "live" | "replay";

export interface McpAdapterOptions {
  traceId: string;
  bus: EventBus;
  mode?: McpAdapterMode;
  recordedEvents?: EventEnvelope[];
  core?: McpCoreServerOptions;
}

export interface McpCallOptions {
  spanId?: string;
  parentSpanId?: string;
  topic?: string;
}

interface McpCallEventData {
  server: string;
  tool: string;
  args_hash: string;
  args_preview?: string;
}

interface McpResultEventData {
  server: string;
  tool: string;
  args_hash: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
  };
  latency_ms?: number;
  cost?: number;
}

type RecordedPair = {
  call: EventEnvelope<McpCallEventData>;
  result: EventEnvelope<McpResultEventData>;
};

interface McpServer {
  id: string;
  invoke(tool: string, args: unknown, ctx: ToolContext): Promise<ToolResult>;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return '"[unserializable]"';
  }
}

function hashArgs(args: unknown): string {
  return createHash("sha256").update(safeStringify(args)).digest("hex");
}

function buildArgsPreview(args: unknown): string | undefined {
  if (args == null) {
    return undefined;
  }
  const serialized = safeStringify(args);
  if (serialized.length <= 512) {
    return serialized;
  }
  return `${serialized.slice(0, 509)}...`;
}

function cloneEnvelope<T>(event: EventEnvelope<T>): EventEnvelope<T> {
  return JSON.parse(JSON.stringify(event)) as EventEnvelope<T>;
}

function extractToolError(result: ToolResult): ToolError | null {
  if (result.ok) {
    return null;
  }
  return result;
}

function mergeLatency(result: ToolResult, latencyMs: number): ToolResult {
  if (!result.ok) {
    return { ...result } satisfies ToolError;
  }
  const existing = result as ToolOk;
  if (typeof existing.latency_ms === "number") {
    return existing;
  }
  return { ...existing, latency_ms: latencyMs } satisfies ToolOk;
}

function createCoreServerForAdapter(options: McpCoreServerOptions = {}): McpServer {
  const resolved: McpCoreServerOptions = {
    root: options.root ?? (options as any)?.workspaceRoot,
  };
  const definition = createCoreMcpServer(resolved);
  return {
    id: definition.id,
    async invoke(tool: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
      const handler = definition.tools[tool];
      if (!handler) {
        return {
          ok: false,
          code: "mcp.tool_not_found",
          message: `tool ${tool} is not available on server ${definition.id}`,
        } satisfies ToolError;
      }
      return handler(args, ctx);
    },
  } satisfies McpServer;
}

export class McpAdapter {
  private readonly servers = new Map<string, McpServer>();
  private readonly recorded = new Map<string, RecordedPair[]>();
  private readonly mode: McpAdapterMode;

  constructor(private readonly options: McpAdapterOptions) {
    this.mode = options.mode ?? "live";
    if (this.mode === "replay" && Array.isArray(options.recordedEvents)) {
      this.ingestRecordedEvents(options.recordedEvents);
    }
  }

  registerServer(server: McpServer): void {
    this.servers.set(server.id, server);
  }

  async call(
    serverId: string,
    tool: string,
    args: unknown,
    options: McpCallOptions = {},
  ): Promise<ToolResult> {
    const argsHash = hashArgs(args);
    const spanId = options.spanId ?? randomUUID();

    if (this.mode === "replay") {
      return this.replayCall(serverId, tool, argsHash, spanId, options);
    }

    const argsPreview = buildArgsPreview(args);
    const callEnvelope: EventEnvelope<McpCallEventData> = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      type: "mcp.call",
      version: 1,
      trace_id: this.options.traceId,
      span_id: spanId,
      parent_span_id: options.parentSpanId,
      topic: options.topic,
      data: {
        server: serverId,
        tool,
        args_hash: argsHash,
        ...(argsPreview ? { args_preview: argsPreview } : {}),
      },
    };

    await this.options.bus.publish(callEnvelope);

    const server = this.servers.get(serverId);
    if (!server) {
      const error: ToolError = {
        ok: false,
        code: "mcp.server_not_found",
        message: `server ${serverId} is not registered`,
      };
      await this.publishResultEnvelope(spanId, serverId, tool, argsHash, error, options);
      return error;
    }

    const started = Date.now();
    let invocationResult: ToolResult;
    try {
      invocationResult = await server.invoke(tool, args, {
        trace_id: this.options.traceId,
        span_id: spanId,
        parent_span_id: options.parentSpanId,
      });
    } catch (err: any) {
      const message = err instanceof Error ? err.message : "unexpected mcp invocation error";
      invocationResult = { ok: false, code: "mcp.invoke_error", message } satisfies ToolError;
    }
    const latency = Date.now() - started;
    const merged = mergeLatency(invocationResult, latency);

    await this.publishResultEnvelope(spanId, serverId, tool, argsHash, merged, options);
    return merged;
  }

  private async replayCall(
    serverId: string,
    tool: string,
    argsHash: string,
    spanId: string,
    options: McpCallOptions,
  ): Promise<ToolResult> {
    const key = this.buildKey(serverId, tool, argsHash);
    const queue = this.recorded.get(key);
    if (!queue || queue.length === 0) {
      return {
        ok: false,
        code: "mcp.replay_missing_result",
        message: "no recorded result available for the given call",
      } satisfies ToolError;
    }

    const pair = queue.shift()!;
    const callEnvelope = cloneEnvelope(pair.call);
    callEnvelope.span_id = callEnvelope.span_id ?? spanId;
    await this.options.bus.publish(callEnvelope);

    const resultEnvelope = cloneEnvelope(pair.result);
    resultEnvelope.span_id = resultEnvelope.span_id ?? spanId;
    await this.options.bus.publish(resultEnvelope);

    if (pair.result.data.ok) {
      const okData = pair.result.data;
      return {
        ok: true,
        data: okData.result,
        latency_ms: okData.latency_ms,
        cost: okData.cost,
      } satisfies ToolOk;
    }

    const errorData = pair.result.data;
    return {
      ok: false,
      code: errorData.error?.code ?? "mcp.replay_error",
      message: errorData.error?.message ?? "recorded call failed",
      ...(errorData.error?.retryable != null ? { retryable: errorData.error.retryable } : {}),
    } satisfies ToolError;
  }

  private async publishResultEnvelope(
    spanId: string,
    serverId: string,
    tool: string,
    argsHash: string,
    result: ToolResult,
    options: McpCallOptions,
  ): Promise<void> {
    const error = extractToolError(result);
    const envelope: EventEnvelope<McpResultEventData> = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      type: "mcp.result",
      version: 1,
      trace_id: this.options.traceId,
      span_id: spanId,
      parent_span_id: options.parentSpanId,
      topic: options.topic,
      data: {
        server: serverId,
        tool,
        args_hash: argsHash,
        ok: result.ok,
        ...(result.ok
          ? {
              result: (result as ToolOk).data,
              latency_ms: (result as ToolOk).latency_ms,
              cost: (result as ToolOk).cost,
            }
          : {
              error: {
                code: error?.code ?? "mcp.error",
                message: error?.message ?? "unknown error",
                ...(error?.retryable != null ? { retryable: error.retryable } : {}),
              },
            }),
      },
    };

    await this.options.bus.publish(envelope);
  }

  private ingestRecordedEvents(events: EventEnvelope[]): void {
    const callBySpan = new Map<string, EventEnvelope<McpCallEventData>>();
    for (const event of events) {
      if (event.type === "mcp.call" && event.span_id) {
        callBySpan.set(event.span_id, event as EventEnvelope<McpCallEventData>);
      }
    }

    for (const event of events) {
      if (event.type !== "mcp.result") {
        continue;
      }
      const resultEvent = event as EventEnvelope<McpResultEventData>;
      const data = resultEvent.data;
      const key = this.buildKey(data.server, data.tool, data.args_hash);
      const spanId = resultEvent.span_id;
      const callEvent =
        (spanId ? callBySpan.get(spanId) : undefined) ?? this.createSyntheticCall(resultEvent);
      const queue = this.recorded.get(key) ?? [];
      queue.push({ call: callEvent, result: resultEvent });
      this.recorded.set(key, queue);
    }
  }

  private createSyntheticCall(
    resultEvent: EventEnvelope<McpResultEventData>,
  ): EventEnvelope<McpCallEventData> {
    return {
      id: randomUUID(),
      ts: resultEvent.ts,
      type: "mcp.call",
      version: resultEvent.version,
      trace_id: resultEvent.trace_id,
      span_id: resultEvent.span_id,
      parent_span_id: resultEvent.parent_span_id,
      topic: resultEvent.topic,
      data: {
        server: resultEvent.data.server,
        tool: resultEvent.data.tool,
        args_hash: resultEvent.data.args_hash,
      },
    };
  }

  private buildKey(server: string, tool: string, argsHash: string): string {
    return `${server}::${tool}::${argsHash}`;
  }
}

export function createMcpAdapter(options: McpAdapterOptions): McpAdapter {
  const adapter = new McpAdapter(options);
  const coreServer = createCoreServerForAdapter(options.core);
  adapter.registerServer(coreServer);
  return adapter;
}

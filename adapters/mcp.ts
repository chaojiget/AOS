import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { ToolError, ToolOk, ToolResult } from "../core/agent";

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
  resources(serverId?: string): Promise<MCPResourceSummary[]>;
  invoke(serverId: string, tool: string, args: any, options?: MCPInvokeOptions): Promise<ToolResult>;
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

interface MCPServerConnection {
  listTools(): Promise<MCPToolSummary[]>;
  listResources(): Promise<MCPResourceSummary[]>;
  invoke(tool: string, args: any, options?: MCPInvokeOptions): Promise<MCPTransportResult>;
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
  constructor(private readonly config: MCPServerConfig & { url: string }, private readonly fetchImpl: typeof fetch) {}

  private buildUrl(path: string): string {
    try {
      const base = new URL(this.config.url);
      return new URL(path, base).toString();
    } catch (error) {
      throw new MCPConnectionError(
        "invalid_url",
        error instanceof Error ? error.message : "invalid MCP server URL",
      );
    }
  }

  private async fetchJson(path: string, init: RequestInit = {}): Promise<{ response: Response; payload: any }> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.buildUrl(path), {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    } catch (error) {
      throw new MCPConnectionError(
        "network_error",
        error instanceof Error ? error.message : "network request failed",
      );
    }

    const text = await response.text();
    if (!text) {
      return { response, payload: undefined };
    }

    try {
      return { response, payload: JSON.parse(text) };
    } catch {
      return { response, payload: { message: text } };
    }
  }

  async listTools(): Promise<MCPToolSummary[]> {
    const { response, payload } = await this.fetchJson("/tools");
    if (!response.ok) {
      throw new MCPConnectionError(
        "http_error",
        `failed to list MCP tools (${response.status})`,
      );
    }
    const tools = Array.isArray(payload?.tools) ? payload.tools : [];
    return tools.map((item: any) => ({
      name: String(item?.name ?? ""),
      description: typeof item?.description === "string" ? item.description : undefined,
      schema: item?.schema,
    }));
  }

  async listResources(): Promise<MCPResourceSummary[]> {
    const { response, payload } = await this.fetchJson("/resources");
    if (!response.ok) {
      throw new MCPConnectionError(
        "http_error",
        `failed to list MCP resources (${response.status})`,
      );
    }
    const resources = Array.isArray(payload?.resources) ? payload.resources : [];
    return resources.map((item: any) => ({
      uri: String(item?.uri ?? ""),
      mime: typeof item?.mime === "string" ? item.mime : undefined,
      description: typeof item?.description === "string" ? item.description : undefined,
    }));
  }

  async invoke(tool: string, args: any, options?: MCPInvokeOptions): Promise<MCPTransportResult> {
    const { response, payload } = await this.fetchJson("/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, args, trace_id: options?.traceId }),
    });

    if (!response.ok) {
      const error = payload?.error ?? payload ?? {};
      const code =
        typeof error.code === "string"
          ? error.code
          : typeof payload?.code === "string"
            ? payload.code
            : `http_${response.status}`;
      const message =
        typeof error.message === "string"
          ? error.message
          : typeof payload?.message === "string"
            ? payload.message
            : `MCP HTTP error (${response.status})`;
      return { ok: false, code, message, retryable: response.status >= 500 };
    }

    if (payload && typeof payload.ok === "boolean") {
      if (payload.ok) {
        return {
          ok: true,
          data: payload.data,
          cost: typeof payload.cost === "number" ? payload.cost : undefined,
          latency_ms:
            typeof payload.latency_ms === "number" ? payload.latency_ms : undefined,
        } satisfies MCPTransportOk;
      }
      const error = payload.error ?? payload;
      return {
        ok: false,
        code: typeof error?.code === "string" ? error.code : "mcp.invoke_error",
        message:
          typeof error?.message === "string" ? error.message : "MCP invocation failed",
        retryable: typeof error?.retryable === "boolean" ? error.retryable : undefined,
      } satisfies MCPTransportError;
    }

    return { ok: true, data: payload } satisfies MCPTransportOk;
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
    const response = await this.send({ type: "invoke", tool, args, trace_id: options?.traceId });
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
    const response = await this.send({ type: "invoke", tool, args, trace_id: options?.traceId });
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
}

class NullMCPClient implements MCPClient {
  isAvailable(): boolean {
    return false;
  }

  hasServer(): boolean {
    return false;
  }

  getDefaultServer(): string | undefined {
    return undefined;
  }

  async tools(): Promise<MCPToolSummary[]> {
    return [];
  }

  async resources(): Promise<MCPResourceSummary[]> {
    return [];
  }

  async invoke(): Promise<ToolResult> {
    return { ok: false, code: "mcp.unavailable", message: "no MCP servers configured" };
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

  async resources(serverId?: string): Promise<MCPResourceSummary[]> {
    const target = serverId ?? this.defaultServerId;
    if (!target) return [];
    const connection = this.connections.get(target);
    if (!connection) return [];
    return connection.listResources();
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
}

export async function loadMCPRegistry(registryPath?: string): Promise<MCPRegistry> {
  const resolvedPath =
    registryPath ?? process.env.AOS_MCP_REGISTRY ?? join(process.cwd(), "mcp.registry.json");

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

  const rawServers = Array.isArray(parsed?.servers) ? parsed.servers : [];
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

export async function createMCPClient(options: MCPClientOptions = {}): Promise<MCPClient> {
  const registry = await loadMCPRegistry(options.registryPath);
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
    return new NullMCPClient();
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


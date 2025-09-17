import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { ToolContext, ToolError, ToolResult } from "../core/agent";

const REGISTRY_ENV_KEY = "MCP_REGISTRY_PATH";

export type MCPTransportKind = "stdio" | "ws" | "http";

export interface MCPRegistryEntry {
  id: string;
  transport: MCPTransportKind;
  cmd?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  default?: boolean;
}

interface MCPTransport {
  connect(): Promise<void>;
  request(method: string, params: any): Promise<any>;
  close(): Promise<void>;
}

class MCPTransportError extends Error {
  constructor(message: string, public readonly detail?: any) {
    super(message);
    this.name = "MCPTransportError";
  }
}

class MCPServerError extends Error {
  constructor(message: string, public readonly data: any) {
    super(message);
    this.name = "MCPServerError";
  }
}

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
};

class StdIoTransport implements MCPTransport {
  private child?: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private connecting?: Promise<void>;

  constructor(private readonly entry: MCPRegistryEntry) {}

  private ensureCommand(): { cmd: string; args: string[] } {
    const cmd = this.entry.cmd;
    if (!cmd) {
      throw new MCPTransportError(`stdio transport for ${this.entry.id} missing cmd`);
    }
    return { cmd, args: this.entry.args ?? [] };
  }

  async connect(): Promise<void> {
    if (this.child) return;
    if (!this.connecting) {
      const { cmd, args } = this.ensureCommand();
      this.connecting = new Promise<void>((resolve, reject) => {
        try {
          const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], env: process.env });
          child.once("error", (err) => {
            this.failAll(
              new MCPTransportError(`stdio transport error: ${err instanceof Error ? err.message : String(err)}`),
            );
            this.child = undefined;
            reject(err);
          });
          child.once("exit", (code, signal) => {
            const reason = typeof code === "number" ? `code ${code}` : signal ? `signal ${signal}` : "unknown";
            this.failAll(new MCPTransportError(`stdio transport exited with ${reason}`));
            this.child = undefined;
          });

          child.stdout.setEncoding("utf8");
          child.stdout.on("data", (chunk: string) => {
            this.buffer += chunk;
            this.processBuffer();
          });

          this.child = child;
          resolve();
        } catch (error) {
          this.child = undefined;
          reject(error);
        }
      });
    }

    try {
      await this.connecting;
    } catch (error) {
      this.connecting = undefined;
      throw error;
    }
  }

  private processBuffer() {
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) {
        try {
          const message = JSON.parse(line);
          const id = message?.id;
          if (typeof id === "number" && this.pending.has(id)) {
            const pending = this.pending.get(id);
            this.pending.delete(id);
            if (pending) {
              if (message.error) {
                pending.reject(new MCPServerError(message.error.message ?? "mcp error", message.error));
              } else {
                pending.resolve(message.result);
              }
            }
          }
        } catch (error) {
          // ignore malformed payloads
        }
      }
      newlineIndex = this.buffer.indexOf("\n");
    }
  }

  private failAll(error: Error) {
    for (const [, pending] of this.pending) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  async request(method: string, params: any): Promise<any> {
    await this.connect();
    if (!this.child || !this.child.stdin.writable) {
      throw new MCPTransportError(`stdio transport for ${this.entry.id} is not writable`);
    }

    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const promise = new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.child.stdin.write(`${payload}\n`, (err) => {
      if (err) {
        const pending = this.pending.get(id);
        if (pending) {
          this.pending.delete(id);
          pending.reject(new MCPTransportError(`failed to write to stdio: ${err.message}`));
        }
      }
    });

    return promise;
  }

  async close(): Promise<void> {
    if (this.child) {
      this.child.removeAllListeners();
      this.child.stdout.removeAllListeners();
      this.child.stdin.end();
      this.child.kill();
      this.child = undefined;
    }
    this.buffer = "";
    this.pending.clear();
  }
}

class WsTransport extends EventEmitter implements MCPTransport {
  private ws?: WebSocket;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private connecting?: Promise<void>;

  constructor(private readonly entry: MCPRegistryEntry) {
    super();
  }

  private ensureUrl(): string {
    if (!this.entry.url) {
      throw new MCPTransportError(`ws transport for ${this.entry.id} missing url`);
    }
    return this.entry.url;
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (!this.connecting) {
      const url = this.ensureUrl();
      this.connecting = new Promise<void>((resolve, reject) => {
        try {
          const ws = new WebSocket(url, { headers: this.entry.headers });
          ws.addEventListener("open", () => {
            this.ws = ws;
            resolve();
          });
          ws.addEventListener("message", (event) => {
            try {
              const data = typeof event.data === "string" ? event.data : event.data?.toString?.() ?? "";
              const message = JSON.parse(data);
              const id = message?.id;
              if (typeof id === "number" && this.pending.has(id)) {
                const pending = this.pending.get(id);
                this.pending.delete(id);
                if (pending) {
                  if (message.error) {
                    pending.reject(new MCPServerError(message.error.message ?? "mcp error", message.error));
                  } else {
                    pending.resolve(message.result);
                  }
                }
              }
            } catch {
              // ignore
            }
          });
          ws.addEventListener("error", (err) => {
            reject(err);
            for (const [, pending] of this.pending) {
              pending.reject(new MCPTransportError("websocket error", err));
            }
            this.pending.clear();
            this.ws = undefined;
          });
          ws.addEventListener("close", () => {
            for (const [, pending] of this.pending) {
              pending.reject(new MCPTransportError("websocket closed"));
            }
            this.pending.clear();
            this.ws = undefined;
          });
        } catch (error) {
          reject(error);
        }
      });
    }

    try {
      await this.connecting;
    } catch (error) {
      this.connecting = undefined;
      throw error;
    }
  }

  async request(method: string, params: any): Promise<any> {
    await this.connect();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new MCPTransportError(`websocket transport for ${this.entry.id} is not open`);
    }
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const promise = new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.ws.send(payload);
    return promise;
  }

  async close(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
    this.pending.clear();
  }
}

class HttpTransport implements MCPTransport {
  constructor(private readonly entry: MCPRegistryEntry) {}

  private ensureUrl(): string {
    if (!this.entry.url) {
      throw new MCPTransportError(`http transport for ${this.entry.id} missing url`);
    }
    return this.entry.url;
  }

  async connect(): Promise<void> {
    // stateless
  }

  async request(method: string, params: any): Promise<any> {
    const url = this.ensureUrl();
    const payload = { jsonrpc: "2.0", id: Date.now(), method, params };
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.entry.headers ?? {}),
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      throw new MCPTransportError(
        `http request failed for ${this.entry.id}: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }

    if (!response.ok) {
      throw new MCPTransportError(`http request failed with status ${response.status}`, {
        status: response.status,
      });
    }

    let data: any;
    try {
      data = await response.json();
    } catch (error) {
      throw new MCPTransportError(`invalid json response from ${this.entry.id}`, error);
    }

    if (data?.error) {
      throw new MCPServerError(data.error.message ?? "mcp error", data.error);
    }

    return data?.result;
  }

  async close(): Promise<void> {
    // stateless
  }
}

function createTransport(entry: MCPRegistryEntry): MCPTransport {
  switch (entry.transport) {
    case "stdio":
      return new StdIoTransport(entry);
    case "ws":
      return new WsTransport(entry);
    case "http":
      return new HttpTransport(entry);
    default:
      throw new MCPTransportError(`unsupported transport ${(entry as any).transport}`);
  }
}

function parseRegistry(value: unknown): MCPRegistryEntry[] {
  if (!value) return [];
  const entries: unknown = Array.isArray(value) ? value : (value as any)?.servers;
  if (!Array.isArray(entries)) return [];

  const results: MCPRegistryEntry[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const id = (entry as any).id;
    const transport = (entry as any).transport;
    if (typeof id !== "string" || typeof transport !== "string") continue;
    if (transport !== "stdio" && transport !== "ws" && transport !== "http") continue;
    results.push({
      id,
      transport,
      cmd: typeof (entry as any).cmd === "string" ? (entry as any).cmd : undefined,
      args: Array.isArray((entry as any).args)
        ? (entry as any).args.filter((item: any) => typeof item === "string")
        : undefined,
      url: typeof (entry as any).url === "string" ? (entry as any).url : undefined,
      headers:
        (entry as any).headers && typeof (entry as any).headers === "object"
          ? Object.fromEntries(
              Object.entries((entry as any).headers).filter(
                ([key, value]) => typeof key === "string" && typeof value === "string",
              ),
            )
          : undefined,
      default: Boolean((entry as any).default),
    });
  }
  return results;
}

export async function loadMCPRegistry(registryPath?: string): Promise<MCPRegistryEntry[]> {
  const resolvedPath = registryPath ?? process.env[REGISTRY_ENV_KEY] ?? resolve(process.cwd(), "mcp.registry.json");
  let raw: string;
  try {
    raw = await readFile(resolvedPath, "utf8");
  } catch (error: any) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw new MCPTransportError(
      `failed to read MCP registry at ${resolvedPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const parsed = JSON.parse(raw);
    return parseRegistry(parsed);
  } catch (error) {
    throw new MCPTransportError(
      `failed to parse MCP registry at ${resolvedPath}: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
}

export interface MCPClient {
  readonly servers: MCPRegistryEntry[];
  readonly defaultServer?: MCPRegistryEntry;
  invoke(serverId: string, toolName: string, args: any, ctx?: ToolContext): Promise<ToolResult>;
  listTools(serverId: string): Promise<any>;
  close(): Promise<void>;
}

class DefaultMCPClient implements MCPClient {
  private transports = new Map<string, MCPTransport>();

  constructor(public readonly servers: MCPRegistryEntry[], public readonly defaultServer?: MCPRegistryEntry) {}

  private getTransport(serverId: string): MCPTransport {
    const existing = this.transports.get(serverId);
    if (existing) return existing;
    const server = this.servers.find((item) => item.id === serverId);
    if (!server) {
      throw new MCPTransportError(`server ${serverId} not found in registry`);
    }
    const transport = createTransport(server);
    this.transports.set(serverId, transport);
    return transport;
  }

  async invoke(serverId: string, toolName: string, args: any, ctx?: ToolContext): Promise<ToolResult> {
    let transport: MCPTransport;
    try {
      transport = this.getTransport(serverId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown transport error";
      return { ok: false, code: "mcp.transport_missing", message, retryable: true } satisfies ToolError;
    }

    try {
      const result = await transport.request("tools/call", {
        name: toolName,
        arguments: args,
        context: ctx,
      });
      if (result && typeof result === "object" && "ok" in result) {
        return result as ToolResult;
      }
      return {
        ok: false,
        code: "mcp.invalid_response",
        message: `invalid MCP response for ${serverId}.${toolName}`,
      } satisfies ToolError;
    } catch (error) {
      if (error instanceof MCPServerError) {
        const code =
          typeof error.data?.code === "string"
            ? error.data.code
            : typeof error.data?.code === "number"
              ? `mcp.server_error.${error.data.code}`
              : "mcp.server_error";
        const message =
          typeof error.data?.message === "string"
            ? error.data.message
            : error.message ?? "MCP server error";
        return { ok: false, code, message } satisfies ToolError;
      }
      const message = error instanceof Error ? error.message : "MCP transport error";
      return { ok: false, code: "mcp.transport_error", message, retryable: true } satisfies ToolError;
    }
  }

  async listTools(serverId: string): Promise<any> {
    const transport = this.getTransport(serverId);
    try {
      const result = await transport.request("tools/list", {});
      if (result && typeof result === "object" && Array.isArray((result as any).tools)) {
        return (result as any).tools;
      }
      return [];
    } catch (error) {
      if (error instanceof MCPServerError) {
        throw new MCPTransportError(error.message, error.data);
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    const closes: Promise<void>[] = [];
    for (const transport of this.transports.values()) {
      closes.push(transport.close());
    }
    this.transports.clear();
    await Promise.allSettled(closes);
  }
}

export async function createMCPClient(options: {
  registryPath?: string;
} = {}): Promise<MCPClient | null> {
  const entries = await loadMCPRegistry(options.registryPath);
  if (entries.length === 0) {
    return null;
  }
  const defaultServer = entries.find((entry) => entry.default) ?? entries[0];
  return new DefaultMCPClient(entries, defaultServer);
}

export type ToolNameParts = {
  serverId: string;
  toolName: string;
};

export function parseQualifiedToolName(name: string, defaultServer?: string): ToolNameParts | null {
  if (typeof name !== "string" || !name) return null;
  const dotIndex = name.indexOf(".");
  if (dotIndex > 0) {
    return { serverId: name.slice(0, dotIndex), toolName: name.slice(dotIndex + 1) };
  }
  if (defaultServer) {
    return { serverId: defaultServer, toolName: name };
  }
  return null;
}

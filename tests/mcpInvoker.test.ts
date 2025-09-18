import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

async function writeRegistry(servers: any[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mcp-reg-"));
  const file = join(dir, "mcp.registry.json");
  await writeFile(file, JSON.stringify({ servers }, null, 2), "utf8");
  return file;
}

interface EnvSnapshot {
  registry?: string;
  replayTrace?: string;
  replayDir?: string;
  fetch?: typeof fetch;
}

function snapshotEnv(): EnvSnapshot {
  return {
    registry: process.env.AOS_MCP_REGISTRY,
    replayTrace: process.env.AOS_REPLAY_TRACE_ID,
    replayDir: process.env.AOS_REPLAY_DIR,
    fetch: (globalThis as any).fetch,
  };
}

function applyEnv(snapshot: EnvSnapshot): void {
  if (snapshot.registry === undefined) {
    delete process.env.AOS_MCP_REGISTRY;
  } else {
    process.env.AOS_MCP_REGISTRY = snapshot.registry;
  }
  if (snapshot.replayTrace === undefined) {
    delete process.env.AOS_REPLAY_TRACE_ID;
  } else {
    process.env.AOS_REPLAY_TRACE_ID = snapshot.replayTrace;
  }
  if (snapshot.replayDir === undefined) {
    delete process.env.AOS_REPLAY_DIR;
  } else {
    process.env.AOS_REPLAY_DIR = snapshot.replayDir;
  }
  if (snapshot.fetch === undefined) {
    delete (globalThis as any).fetch;
  } else {
    (globalThis as any).fetch = snapshot.fetch;
  }
}

function clearMcpEnv(): void {
  delete process.env.AOS_MCP_REGISTRY;
  delete process.env.AOS_REPLAY_TRACE_ID;
  delete process.env.AOS_REPLAY_DIR;
}

interface MockResponse {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<any>;
}

function jsonResponse(body: any, status = 200): MockResponse {
  const payload = JSON.stringify(body ?? null);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name: string) {
        return name.toLowerCase() === "content-type" ? "application/json" : null;
      },
    },
    async text() {
      return payload;
    },
    async json() {
      return body;
    },
  };
}

describe("createDefaultToolInvoker with MCP integration", () => {
  it("routes server-prefixed tool calls to the configured MCP server", async () => {
    const env = snapshotEnv();
    clearMcpEnv();
    const registryPath = await writeRegistry([
      { id: "remote", transport: "http", url: "http://mcp.local" },
    ]);
    process.env.AOS_MCP_REGISTRY = registryPath;

    const { createDefaultToolInvoker } = await import("../adapters/core");
    const invoker = createDefaultToolInvoker();

    try {
      const fetchCalls: Array<{ url: string; body: any }> = [];
      (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
        const payload = typeof init?.body === "string" ? JSON.parse(init.body) : null;
        fetchCalls.push({ url: String(url), body: payload });
        if (init?.method === "POST") {
          return jsonResponse({
            ok: true,
            data: { echoed: payload?.args ?? null, trace: payload?.trace_id },
          });
        }
        return jsonResponse({ tools: [] });
      };

      const result = await invoker(
        { name: "remote.ping", args: { value: 123 } },
        { trace_id: "trace-prefixed" },
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual({ echoed: { value: 123 }, trace: "trace-prefixed" });
        expect(typeof result.latency_ms).toBe("number");
      }
      expect(fetchCalls.length > 0).toBe(true);
      expect(fetchCalls[0]?.body?.trace_id).toBe("trace-prefixed");
    } finally {
      applyEnv(env);
    }
  });

  it("uses the default MCP server when no prefix is provided", async () => {
    const env = snapshotEnv();
    clearMcpEnv();
    const registryPath = await writeRegistry([
      { id: "default", transport: "http", url: "http://mcp.local/default", default: true },
    ]);
    process.env.AOS_MCP_REGISTRY = registryPath;

    const { createDefaultToolInvoker } = await import("../adapters/core");
    const invoker = createDefaultToolInvoker();

    try {
      const fetchCalls: Array<{ url: string; body: any }> = [];
      (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
        const payload = typeof init?.body === "string" ? JSON.parse(init.body) : null;
        fetchCalls.push({ url: String(url), body: payload });
        if (init?.method === "POST") {
          return jsonResponse({
            ok: true,
            data: { source: "default", args: payload?.args ?? null },
          });
        }
        return jsonResponse({ tools: [] });
      };

      const result = await invoker(
        { name: "ping", args: { hello: "world" } },
        { trace_id: "trace-default" },
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual({ source: "default", args: { hello: "world" } });
      }
      expect(fetchCalls.length > 0).toBe(true);
    } finally {
      applyEnv(env);
    }
  });

  it("falls back to local tools when no MCP registry is available", async () => {
    const env = snapshotEnv();
    clearMcpEnv();
    const { createDefaultToolInvoker } = await import("../adapters/core");
    const invoker = createDefaultToolInvoker();
    const result = await invoker(
      { name: "echo", args: { foo: "bar" } },
      { trace_id: "trace-local" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ foo: "bar" });
    }
    applyEnv(env);
  });

  it("surfaces MCP network errors without suppressing them", async () => {
    const env = snapshotEnv();
    clearMcpEnv();
    const registryPath = await writeRegistry([
      { id: "remote", transport: "http", url: "http://mcp.local/failure" },
    ]);
    process.env.AOS_MCP_REGISTRY = registryPath;

    const { createDefaultToolInvoker } = await import("../adapters/core");
    const invoker = createDefaultToolInvoker();

    (globalThis as any).fetch = async () => {
      throw new Error("network down");
    };

    const result = await invoker({ name: "remote.ping", args: {} }, { trace_id: "trace-error" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("mcp.network_error");
      expect(result.retryable).toBe(true);
    }
    applyEnv(env);
  });

  it("falls back to local tools when the MCP server reports tool.not_found", async () => {
    const env = snapshotEnv();
    clearMcpEnv();
    const registryPath = await writeRegistry([
      { id: "remote", transport: "http", url: "http://mcp.local/not-found", default: true },
    ]);
    process.env.AOS_MCP_REGISTRY = registryPath;

    const { createDefaultToolInvoker } = await import("../adapters/core");
    const invoker = createDefaultToolInvoker();

    try {
      (globalThis as any).fetch = async (_url: string, init?: RequestInit) => {
        const payload = typeof init?.body === "string" ? JSON.parse(init.body) : null;
        if (init?.method === "POST") {
          return jsonResponse({
            ok: false,
            error: { code: "tool.not_found", message: "missing" },
            data: payload,
          });
        }
        return jsonResponse({ tools: [] });
      };

      const result = await invoker(
        { name: "echo", args: { hi: "there" } },
        { trace_id: "trace-fallback" },
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual({ hi: "there" });
      }
    } finally {
      applyEnv(env);
    }
  });
});

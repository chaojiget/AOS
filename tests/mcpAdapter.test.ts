import { Buffer } from "node:buffer";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

async function createRegistry(
  entries: any[],
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "mcp-registry-"));
  const filePath = join(dir, "mcp.registry.json");
  await writeFile(filePath, JSON.stringify(entries), "utf8");
  return {
    path: filePath,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

describe("MCP adapter", () => {
  it("returns null when registry file is missing", async () => {
    const { createMCPClient } = await import("../adapters/mcp");
    const missingPath = join(tmpdir(), `missing-registry-${Date.now()}.json`);
    const client = await createMCPClient({ registryPath: missingPath });
    expect(client).toBe(null);
  });

  it("returns transport error when connection fails", async () => {
    const registry = await createRegistry([
      {
        id: "offline",
        transport: "http",
        url: "http://127.0.0.1:9",
        default: true,
      },
    ]);
    try {
      const { createMCPClient } = await import("../adapters/mcp");
      const client = await createMCPClient({ registryPath: registry.path });
      expect(client).not.toBe(null);
      const result = await client!.invoke("offline", "ping", { value: 1 }, { trace_id: "test" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code.startsWith("mcp.")).toBe(true);
      }
    } finally {
      await registry.cleanup();
    }
  });

  it("invokes tools via HTTP registry entry and integrates with default tool invoker", async () => {
    const registry = await createRegistry([
      { id: "mock", transport: "http", url: "http://mock.mcp.test/rpc", default: true },
    ]);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: any, init?: any) => {
      const targetUrl = typeof input === "string" ? input : (input?.url ?? "");
      if (targetUrl === "http://mock.mcp.test/rpc") {
        const bodyValue =
          typeof init?.body === "string"
            ? init.body
            : init?.body instanceof Uint8Array
              ? Buffer.from(init.body).toString("utf8")
              : (init?.body?.toString?.() ?? "");
        const payload = bodyValue ? JSON.parse(bodyValue) : {};
        const id = payload.id ?? null;
        const method = payload.method;
        if (method === "tools/list") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              result: { tools: [{ name: "ping", description: "Ping tool" }] },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (method === "tools/call") {
          if (payload.params?.name === "missing") {
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id,
                error: { code: "tool.not_found", message: "unknown tool" },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          const value = payload.params?.arguments?.value ?? null;
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              result: { ok: true, data: { echoed: value } },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: "mcp.unsupported", message: "bad" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (typeof originalFetch === "function") {
        return originalFetch(input, init);
      }
      throw new Error("unexpected fetch invocation");
    };

    try {
      process.env.MCP_REGISTRY_PATH = registry.path;
      const { createMCPClient } = await import("../adapters/mcp");
      const client = await createMCPClient();
      expect(client).not.toBe(null);

      const tools = await client!.listTools("mock");
      expect(Array.isArray(tools)).toBe(true);
      expect(tools[0]?.name).toBe("ping");

      const result = await client!.invoke("mock", "ping", { value: 42 }, { trace_id: "trace" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual({ echoed: 42 });
      }

      const missing = await client!.invoke("mock", "missing", {}, { trace_id: "trace" });
      expect(missing.ok).toBe(false);
      if (!missing.ok) {
        expect(missing.code).toBe("tool.not_found");
      }

      await client!.close();

      process.env.MCP_REGISTRY_PATH = registry.path;
      const { createDefaultToolInvoker } = await import("../adapters/core");
      const invoker = createDefaultToolInvoker();

      const remoteDefault = await invoker(
        { name: "ping", args: { value: 7 } },
        { trace_id: "abc" },
      );
      expect(remoteDefault.ok).toBe(true);
      if (remoteDefault.ok) {
        expect(remoteDefault.data).toEqual({ echoed: 7 });
      }

      const remotePrefixed = await invoker(
        { name: "mock.ping", args: { value: 9 } },
        { trace_id: "def" },
      );
      expect(remotePrefixed.ok).toBe(true);
      if (remotePrefixed.ok) {
        expect(remotePrefixed.data).toEqual({ echoed: 9 });
      }

      const fallback = await invoker({ name: "mock.missing", args: {} }, { trace_id: "ghi" });
      expect(fallback.ok).toBe(false);
      if (!fallback.ok) {
        expect(fallback.code).toBe("tool.not_found");
      }
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.MCP_REGISTRY_PATH;
      await registry.cleanup();
    }
  });
});

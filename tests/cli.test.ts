import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "../cli";

interface MemoryWriter {
  write(chunk: string): unknown;
  toString(): string;
}

function createMemoryWriter(): MemoryWriter {
  let buffer = "";
  return {
    write(chunk: string) {
      buffer += String(chunk);
      return true;
    },
    toString() {
      return buffer;
    },
  };
}

describe("CLI mcp add", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "aos-cli-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("creates a new registry file on first add", async () => {
    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();

    const code = await runCli(
      ["mcp", "add", "--transport", "ws", "mcp-search", "wss://example.com"],
      { cwd, stdout, stderr },
    );

    expect(code).toBe(0);
    expect(stderr.toString()).toBe("");
    expect(stdout.toString().includes('已添加 MCP 端点 "mcp-search"')).toBe(true);

    const registryRaw = await readFile(join(cwd, "mcp.registry.json"), "utf8");
    const registry = JSON.parse(registryRaw) as { servers: any[] };
    expect(registry.servers).toHaveLength(1);
    expect(registry.servers[0]).toMatchObject({
      id: "mcp-search",
      transport: "ws",
      url: "wss://example.com",
    });
  });

  it("does not duplicate servers when the same id is added twice", async () => {
    await runCli(["mcp", "add", "--transport", "ws", "mcp-search", "wss://example.com"], {
      cwd,
      stdout: createMemoryWriter(),
      stderr: createMemoryWriter(),
    });

    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();
    const code = await runCli(
      ["mcp", "add", "--transport", "ws", "mcp-search", "wss://example.com"],
      { cwd, stdout, stderr },
    );

    expect(code).toBe(0);
    expect(stderr.toString()).toBe("");
    expect(stdout.toString().includes('MCP 端点 "mcp-search" 配置未变')).toBe(true);

    const registryRaw = await readFile(join(cwd, "mcp.registry.json"), "utf8");
    const registry = JSON.parse(registryRaw) as { servers: any[] };
    expect(registry.servers).toHaveLength(1);
  });

  it("marks the server as default when --default is provided", async () => {
    await runCli(["mcp", "add", "--transport", "ws", "mcp-search", "wss://example.com"], {
      cwd,
      stdout: createMemoryWriter(),
      stderr: createMemoryWriter(),
    });

    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();
    const code = await runCli(
      ["mcp", "add", "--transport", "ws", "mcp-primary", "wss://primary.example.com", "--default"],
      { cwd, stdout, stderr },
    );

    expect(code).toBe(0);
    expect(stderr.toString()).toBe("");
    expect(stdout.toString().includes('已将 "mcp-primary" 设置为默认端点')).toBe(true);

    const registryRaw = await readFile(join(cwd, "mcp.registry.json"), "utf8");
    const registry = JSON.parse(registryRaw) as { servers: any[] };
    const searchServer = registry.servers.find((server) => server.id === "mcp-search");
    const defaultServer = registry.servers.find((server) => server.id === "mcp-primary");
    expect(Boolean(searchServer?.default)).toBe(false);
    expect(Boolean(defaultServer?.default)).toBe(true);
  });
});

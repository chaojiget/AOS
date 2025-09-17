import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MCPRegistry } from "../config/mcpRegistry";

describe("CLI mcp add command", () => {
  let tempDir: string;
  let registryPath: string;
  let runCLI: (argv: string[]) => Promise<number>;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "aos-cli-"));
    registryPath = path.join(tempDir, "mcp.registry.json");
    process.env.MCP_REGISTRY_PATH = registryPath;
    ({ runCLI } = await import("../cli"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    delete process.env.MCP_REGISTRY_PATH;
  });

  async function loadRegistry(): Promise<MCPRegistry> {
    const data = await readFile(registryPath, "utf8");
    return JSON.parse(data) as MCPRegistry;
  }

  it("creates a default registry when the file is missing", async () => {
    const exitCode = await runCLI([
      "mcp",
      "add",
      "--transport",
      "ws",
      "alpha",
      "wss://alpha.example",
    ]);

    expect(exitCode).toBe(0);

    const registry = await loadRegistry();
    expect(registry.servers).toEqual([
      {
        id: "alpha",
        transport: "ws",
        url: "wss://alpha.example",
      },
    ]);
    expect(registry.defaultServerId).toBe(undefined);
  });

  it("does not duplicate entries when the same server is added twice", async () => {
    await runCLI(["mcp", "add", "--transport", "ws", "alpha", "wss://alpha.example"]);
    const exitCode = await runCLI([
      "mcp",
      "add",
      "--transport",
      "ws",
      "alpha",
      "wss://alpha.example",
    ]);

    expect(exitCode).toBe(0);

    const registry = await loadRegistry();
    expect(registry.servers).toHaveLength(1);
    expect(registry.servers[0]).toMatchObject({
      id: "alpha",
      transport: "ws",
      url: "wss://alpha.example",
    });
  });

  it("sets the default server when --default is provided", async () => {
    const exitCode = await runCLI([
      "mcp",
      "add",
      "--transport",
      "ws",
      "beta",
      "wss://beta.example",
      "--default",
    ]);

    expect(exitCode).toBe(0);

    const registry = await loadRegistry();
    expect(registry.defaultServerId).toBe("beta");
    expect(registry.servers[0]).toMatchObject({ id: "beta" });
  });
});

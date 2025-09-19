import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Test, type TestingModule } from "@nestjs/testing";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApiConfigModule } from "../../servers/api/src/config/api-config.module";
import { DatabaseModule } from "../../servers/api/src/database/database.module";
import { McpController } from "../../servers/api/src/mcp/mcp.controller";
import { McpModule } from "../../servers/api/src/mcp/mcp.module";

const originalEnv = { ...process.env };

function resetEnv(): void {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
}

async function createModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [ApiConfigModule, DatabaseModule, McpModule],
  }).compile();
}

describe("MCP registry controller", () => {
  beforeEach(() => {
    resetEnv();
  });

  afterEach(() => {
    resetEnv();
  });

  it("removes a configuration in memory mode and returns the remaining entries", async () => {
    process.env.AOS_USE_IN_MEMORY_DB = "1";

    const moduleRef = await createModule();
    const controller = moduleRef.get(McpController);

    const first = await controller.register({ name: "memory-1", transport: "http" });
    const second = await controller.register({ name: "memory-2", transport: "ws" });

    expect(first.config).toBeTruthy();
    expect(second.config).toBeTruthy();

    const response = await controller.remove(first.config!.id);

    expect(response.configs).toHaveLength(1);
    expect(response.configs[0]?.id).toBe(second.config?.id);
    expect(response.configs[0]?.name).toBe("memory-2");

    await moduleRef.close();
  });

  it("removes a configuration in sqlite mode and returns the remaining entries", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "aos-mcp-test-"));
    process.env.AOS_DB_PATH = join(workDir, "db.sqlite");
    delete process.env.AOS_USE_IN_MEMORY_DB;

    const moduleRef = await createModule();
    const controller = moduleRef.get(McpController);

    const first = await controller.register({ name: "sqlite-1", transport: "http" });
    const second = await controller.register({ name: "sqlite-2", transport: "stdio" });

    expect(first.config).toBeTruthy();
    expect(second.config).toBeTruthy();

    const response = await controller.remove(second.config!.id);

    expect(response.configs).toHaveLength(1);
    expect(response.configs[0]?.id).toBe(first.config?.id);
    expect(response.configs[0]?.name).toBe("sqlite-1");

    await moduleRef.close();
    rmSync(workDir, { recursive: true, force: true });
  });
});

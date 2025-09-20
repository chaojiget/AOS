import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestApp, type TestAppContext } from "./support/testApp";
import { HealthController } from "../../servers/api/src/health/health.controller";

describe("Health API", () => {
  let context: TestAppContext;
  let controller: HealthController;

  beforeEach(async () => {
    context = await createTestApp();
    controller = context.moduleRef.get(HealthController);
  });

  afterEach(async () => {
    await context.cleanup();
  });

  it("returns overall ok status and database health", async () => {
    const response = await controller.check();

    expect(response.status).toBe("ok");
    expect(response.info?.database?.status).toBe("up");
  });
});

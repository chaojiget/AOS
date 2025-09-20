import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";

import { AppModule } from "../../../servers/api/src/app.module";
import { EpisodesController } from "../../../servers/api/src/episodes/episodes.controller";
import { EpisodesService } from "../../../servers/api/src/episodes/episodes.service";
import {
  RUN_KERNEL_FACTORY,
  type CreateKernelOptions,
  type RunKernelFactory,
} from "../../../servers/api/src/runs/run-kernel.factory";
import type { ActionOutcome, AgentKernel, Plan, PlanStep, ReviewResult } from "../../../core/agent";

const originalEnv = { ...process.env };

export interface TestAppContext {
  app: INestApplication;
  moduleRef: TestingModule;
  workDir: string;
  episodesDir: string;
  cleanup: () => Promise<void>;
}

class SimpleStubKernel implements AgentKernel {
  private planned = false;
  private readonly message: string;

  constructor(message: string) {
    this.message = message;
  }

  async perceive(): Promise<void> {}

  async plan(): Promise<Plan> {
    if (this.planned) {
      return { revision: 2, steps: [] } satisfies Plan;
    }
    this.planned = true;
    const step: PlanStep = {
      id: `stub-step-${randomUUID()}`,
      op: "local.echo",
      args: { text: this.message || "" },
      description: "echo message",
    };
    return {
      revision: 1,
      reason: "stub",
      steps: [step],
    } satisfies Plan;
  }

  async act(step: PlanStep): Promise<ActionOutcome> {
    return {
      step,
      result: { ok: true, data: { echoed: step.args }, latency_ms: 1 },
    } satisfies ActionOutcome;
  }

  async review(): Promise<ReviewResult> {
    return { score: 1, passed: true } satisfies ReviewResult;
  }

  async renderFinal(actions: ActionOutcome[]): Promise<any> {
    const lastOutcome = actions.at(-1)?.result;
    const lastData =
      lastOutcome && typeof lastOutcome === "object" && "data" in lastOutcome
        ? ((lastOutcome as { data?: unknown }).data ?? null)
        : null;
    return {
      message: `echoed:${actions.length}`,
      last: lastData,
    };
  }
}

class SimpleStubKernelFactory implements RunKernelFactory {
  async createKernel(options: CreateKernelOptions): Promise<AgentKernel> {
    return new SimpleStubKernel(options.message);
  }
}

export async function createTestApp(): Promise<TestAppContext> {
  const workDir = await mkdtemp(join(tmpdir(), "aos-api-test-"));
  const episodesDir = join(workDir, "episodes");
  await mkdir(episodesDir, { recursive: true });

  process.env = {
    ...originalEnv,
    AOS_USE_IN_MEMORY_DB: "1",
    AOS_EPISODES_DIR: episodesDir,
    AOS_DB_PATH: join(workDir, "db.sqlite"),
    AOS_EVENTS_PATH: join(workDir, "events.json"),
    AOS_API_KEY: "",
  };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RUN_KERNEL_FACTORY)
    .useClass(SimpleStubKernelFactory)
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("api");
  await app.init();

  const originalGet = moduleRef.get.bind(moduleRef);
  (moduleRef as any).get = ((token: unknown, options?: any) => {
    if (token === "EpisodesController") {
      const resolved = originalGet(EpisodesController, options ?? { strict: false });
      if (resolved) {
        return resolved;
      }
      const service = originalGet(EpisodesService, options ?? { strict: false });
      return service ? new EpisodesController(service) : undefined;
    }
    return originalGet(token as any, options);
  }) as typeof moduleRef.get;

  const cleanup = async () => {
    await app.close();
    await moduleRef.close();
    await rm(workDir, { recursive: true, force: true });
    process.env = { ...originalEnv };
  };

  return { app, moduleRef, workDir, episodesDir, cleanup };
}

import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { AppModule } from "../../servers/api/src/app.module";
import {
  RUN_KERNEL_FACTORY,
  type CreateKernelOptions,
  type RunKernelFactory,
} from "../../servers/api/src/runs/run-kernel.factory";
import { AgentController } from "../../servers/api/src/agent/agent.controller";
import { RunsService } from "../../servers/api/src/runs/runs.service";
import type { ActionOutcome, AgentKernel, Plan, PlanStep, ReviewResult } from "../../core/agent";

class StubKernel implements AgentKernel {
  private planned = false;

  constructor(private readonly message: string) {}

  async perceive(): Promise<void> {}

  async plan(): Promise<Plan> {
    if (this.planned) {
      return { revision: 2, steps: [] } satisfies Plan;
    }
    this.planned = true;
    const step: PlanStep = {
      id: `stub-step-${randomUUID()}`,
      op: "local.echo",
      args: { text: this.message },
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
    return { text: `finished:${actions.length}` };
  }
}

class StubKernelFactory implements RunKernelFactory {
  async createKernel(options: CreateKernelOptions): Promise<AgentKernel> {
    return new StubKernel(options.message);
  }
}

describe("API run endpoints", () => {
  it("runs agent start to completion and streams events", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "aos-api-"));
    process.env.AOS_API_KEY = "test-key";
    process.env.AOS_DB_PATH = join(tmpDir, "test.sqlite");
    process.env.AOS_EPISODES_DIR = join(tmpDir, "episodes");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RUN_KERNEL_FACTORY)
      .useClass(StubKernelFactory)
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();

    const agentController = app.get(AgentController);
    const runsService = app.get(RunsService);

    try {
      const startResponse = await agentController.startRun({ message: "hello" });
      const runId = startResponse.runId as string;
      expect(typeof runId).toBe("string");

      const streamPromise = new Promise<void>((resolve, reject) => {
        const subscription = runsService.stream(runId).subscribe({
          next(event) {
            if (event.type === "run.finished") {
              subscription.unsubscribe();
              resolve();
            }
          },
          error(error) {
            subscription.unsubscribe();
            reject(error);
          },
          complete() {
            subscription.unsubscribe();
            resolve();
          },
        });
        setTimeout(() => {
          subscription.unsubscribe();
          reject(new Error("stream did not emit run.finished"));
        }, 5000);
      });

      let summary;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        summary = await runsService.getRun(runId);
        if (summary.status !== "running") {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      expect(summary?.status).toBe("completed");
      expect(summary?.finalResult).toEqual({ text: "finished:1" });

      const eventsRes = await runsService.getRunEvents(runId);
      expect(Array.isArray(eventsRes)).toBe(true);
      const hasFinished = eventsRes.some((evt) => evt.type === "run.finished");
      expect(hasFinished).toBe(true);

      await streamPromise;
    } finally {
      await app.close();
      await rm(tmpDir, { recursive: true, force: true });
    }
  }, 10000);
});

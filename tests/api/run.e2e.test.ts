import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { AppModule } from "../../servers/api/src/app.module";
import { createDefaultToolInvoker } from "../../adapters/core";
import {
  RUN_KERNEL_FACTORY,
  type CreateKernelOptions,
  type RunKernelFactory,
} from "../../servers/api/src/runs/run-kernel.factory";
import { AgentController } from "../../servers/api/src/agent/agent.controller";
import { RunsService } from "../../servers/api/src/runs/runs.service";
import type {
  ActionOutcome,
  AgentKernel,
  Plan,
  PlanStep,
  ReviewResult,
  ToolInvoker,
} from "../../core/agent";

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

class SensitiveKernel implements AgentKernel {
  private planned = false;

  constructor(private readonly toolInvoker: ToolInvoker, private readonly traceId: string) {}

  async perceive(): Promise<void> {}

  async plan(): Promise<Plan> {
    if (this.planned) {
      return { revision: 2, steps: [] } satisfies Plan;
    }
    this.planned = true;
    const step: PlanStep = {
      id: `write-step-${randomUUID()}`,
      op: "file.write",
      args: { path: "output.txt", content: "hello" },
      description: "write file",
    };
    return {
      revision: 1,
      reason: "sensitive",
      steps: [step],
    } satisfies Plan;
  }

  async act(step: PlanStep): Promise<ActionOutcome> {
    const result = await this.toolInvoker({ name: step.op, args: step.args }, {
      trace_id: this.traceId,
      span_id: step.id,
    });
    return { step, result } satisfies ActionOutcome;
  }

  async review(actions: ActionOutcome[]): Promise<ReviewResult> {
    const passed = actions.every((action) => action.result.ok);
    return { score: passed ? 1 : 0, passed } satisfies ReviewResult;
  }

  async renderFinal(actions: ActionOutcome[]): Promise<any> {
    return {
      actions: actions.map((action) => ({
        id: action.step.id,
        ok: action.result.ok,
      })),
    };
  }
}

class SensitiveKernelFactory implements RunKernelFactory {
  async createKernel(options: CreateKernelOptions): Promise<AgentKernel> {
    const toolInvoker = createDefaultToolInvoker({
      eventBus: options.eventBus,
      approvalAdapter: options.approvalAdapter,
    });
    return new SensitiveKernel(toolInvoker, options.traceId);
  }
}

async function waitForRunStatus(
  service: RunsService,
  runId: string,
  expected: string,
  timeoutMs = 5000,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const summary = await service.getRun(runId);
    if (summary.status === expected) {
      return summary;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`run ${runId} did not reach status ${expected}`);
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

  it("requires approval for sensitive tools", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "aos-approval-"));
    process.env.AOS_API_KEY = "test-key";
    process.env.AOS_DB_PATH = join(tmpDir, "test.sqlite");
    process.env.AOS_EPISODES_DIR = join(tmpDir, "episodes");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RUN_KERNEL_FACTORY)
      .useClass(SensitiveKernelFactory)
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();

    const agentController = app.get(AgentController);
    const runsService = app.get(RunsService);

    try {
      const { runId: approveRunId } = await agentController.startRun({ message: "approve" });
      const approveId = approveRunId as string;
      await waitForRunStatus(runsService, approveId, "awaiting_confirmation");

      const approvalEvents = await runsService.getRunEvents(approveId);
      const approvalRequest = approvalEvents.find((evt) => evt.type === "user.confirm.request");
      expect(approvalRequest).toBeDefined();
      const approvalRequestId =
        (approvalRequest?.data as any)?.request_id ?? approvalRequest?.id ?? "";
      expect(typeof approvalRequestId).toBe("string");

      await runsService.decideApproval(approveId, approvalRequestId, "approve");
      const approvedSummary = await waitForRunStatus(runsService, approveId, "completed");
      expect(approvedSummary.status).toBe("completed");

      const approvedEvents = await runsService.getRunEvents(approveId);
      const hasGuardianAlert = approvedEvents.some((evt) => evt.type === "guardian.alert");
      expect(hasGuardianAlert).toBe(false);

      const { runId: rejectRunId } = await agentController.startRun({ message: "reject" });
      const rejectId = rejectRunId as string;
      await waitForRunStatus(runsService, rejectId, "awaiting_confirmation");
      const rejectEvents = await runsService.getRunEvents(rejectId);
      const rejectRequest = rejectEvents.find((evt) => evt.type === "user.confirm.request");
      expect(rejectRequest).toBeDefined();
      const rejectRequestId =
        (rejectRequest?.data as any)?.request_id ?? rejectRequest?.id ?? "";
      expect(typeof rejectRequestId).toBe("string");

      await runsService.decideApproval(rejectId, rejectRequestId, "reject");
      const failedSummary = await waitForRunStatus(runsService, rejectId, "failed");
      expect(failedSummary.status).toBe("failed");

      const eventsAfterReject = await runsService.getRunEvents(rejectId);
      const guardianAlert = eventsAfterReject.find((evt) => evt.type === "guardian.alert");
      expect(guardianAlert).toBeDefined();
    } finally {
      await app.close();
      await rm(tmpDir, { recursive: true, force: true });
    }
  }, 20000);
});

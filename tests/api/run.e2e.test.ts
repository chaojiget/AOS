import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { ActionOutcome, AgentKernel, Plan, PlanStep, ReviewResult } from "../../core/agent";
import { AppModule } from "../../servers/api/src/app.module";
import {
  RUN_KERNEL_FACTORY,
  type RunKernelFactory,
  type CreateKernelOptions,
} from "../../servers/api/src/runs/run-kernel.factory";

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
    const server = await app.listen(0);
    const address = server.address() as AddressInfo | string;
    const port = typeof address === "string" ? 80 : address.port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const startResponse = await request(app.getHttpServer())
        .post("/api/agent/start")
        .send({ message: "hello" })
        .expect(201);

      const runId = startResponse.body.runId as string;
      expect(typeof runId).toBe("string");

      let summary;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const res = await request(app.getHttpServer()).get(`/api/runs/${runId}`).expect(200);
        summary = res.body;
        if (summary.status !== "running") {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      expect(summary.status).toBe("completed");
      expect(summary.finalResult).toEqual({ text: "finished:1" });

      const eventsRes = await request(app.getHttpServer())
        .get(`/api/runs/${runId}/events`)
        .expect(200);
      expect(Array.isArray(eventsRes.body.events)).toBe(true);
      const hasFinished = eventsRes.body.events.some((evt: any) => evt.type === "run.finished");
      expect(hasFinished).toBe(true);

      const response = await fetch(`${baseUrl}/api/runs/${runId}/stream`, {
        headers: {
          Accept: "text/event-stream",
          Authorization: "Bearer test-key",
        },
      });
      expect(response.ok).toBe(true);

      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      let buffer = "";
      let receivedFinished = false;
      const decoder = new TextDecoder();
      if (reader) {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          if (buffer.includes("event: run.finished") || buffer.includes("event:run.finished")) {
            receivedFinished = true;
            break;
          }
        }
        await reader.cancel();
      }

      expect(receivedFinished).toBe(true);
    } finally {
      await app.close();
      await rm(tmpDir, { recursive: true, force: true });
    }
  }, 30000);
});

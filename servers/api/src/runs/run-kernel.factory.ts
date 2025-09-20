import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  createChatKernel,
  createDefaultToolInvoker,
  type SensitiveToolApprovalAdapter,
} from "../../../../adapters/core";
import type {
  AgentKernel,
  Plan,
  PlanStep,
  ActionOutcome,
  ReviewResult,
} from "../../../../core/agent";
import type { ChatMessage } from "../../../../types/chat";
import type { EventBus } from "../../../../runtime/events";

export interface CreateKernelOptions {
  traceId: string;
  message: string;
  history: ChatMessage[];
  eventBus: EventBus;
  approvalAdapter?: SensitiveToolApprovalAdapter;
}

export interface RunKernelFactory {
  createKernel(options: CreateKernelOptions): Promise<AgentKernel>;
}

export const RUN_KERNEL_FACTORY = Symbol("RUN_KERNEL_FACTORY");

@Injectable()
export class DefaultRunKernelFactory implements RunKernelFactory {
  async createKernel(options: CreateKernelOptions): Promise<AgentKernel> {
    const shouldUseStub = process.env.AOS_RUN_KERNEL === "stub" || !process.env.OPENAI_API_KEY;
    if (shouldUseStub) {
      return new StubEchoKernel(options.message, options.history ?? []);
    }
    const toolInvoker = createDefaultToolInvoker({
      eventBus: options.eventBus,
      approvalAdapter: options.approvalAdapter,
    });
    return createChatKernel({
      message: options.message,
      traceId: options.traceId,
      toolInvoker,
      history: options.history,
    });
  }
}

class StubEchoKernel implements AgentKernel {
  private planned = false;
  private readonly message: string;
  private readonly history: ChatMessage[];

  constructor(message: string, history: ChatMessage[]) {
    this.message = message;
    this.history = Array.isArray(history) ? history : [];
  }

  async perceive(): Promise<void> {}

  async plan(): Promise<Plan> {
    if (this.planned) {
      return { revision: 2, steps: [] } satisfies Plan;
    }
    this.planned = true;
    const step: PlanStep = {
      id: `stub-step-${randomUUID()}`,
      op: "stub.echo",
      args: {
        message: this.message,
        history: this.history,
      },
      description: "Echo the latest user message",
    } satisfies PlanStep;
    return {
      revision: 1,
      reason: "stub",
      notes: ["using stub kernel because OPENAI_API_KEY is missing"],
      steps: [step],
    } satisfies Plan;
  }

  async act(step: PlanStep): Promise<ActionOutcome> {
    return {
      step,
      result: {
        ok: true,
        data: {
          echoed: step.args,
        },
      },
    } satisfies ActionOutcome;
  }

  async review(): Promise<ReviewResult> {
    return {
      score: 1,
      passed: true,
      notes: ["stub kernel review"],
    } satisfies ReviewResult;
  }

  async renderFinal(actions: ActionOutcome[]): Promise<any> {
    const last = actions.at(-1)?.result;
    return {
      message: this.message || "(空输入)",
      echoed: last?.ok ? last.data : null,
      stub: true,
    };
  }
}

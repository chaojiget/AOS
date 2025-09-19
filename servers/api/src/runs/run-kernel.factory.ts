import { Injectable } from "@nestjs/common";
import {
  createChatKernel,
  createDefaultToolInvoker,
  type SensitiveToolApprovalAdapter,
} from "../../../../adapters/core";
import type { AgentKernel } from "../../../../core/agent";
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

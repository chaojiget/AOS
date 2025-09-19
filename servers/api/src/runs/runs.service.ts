import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { eq, and, gt } from "drizzle-orm";
import { Observable, ReplaySubject } from "rxjs";
import {
  runLoop,
  type CoreEvent,
  type EmitSpanOptions,
  type RunLoopResult,
  type RunLoopBudget,
} from "../../../../core/agent";
import { EventBus, createRunEvent, wrapCoreEvent, type EventEnvelope } from "../../../../runtime/events";
import { EpisodeLogger } from "../../../../runtime/episode";
import type { ChatMessage } from "../../../../types/chat";
import { DatabaseService } from "../database/database.service";
import { ApiConfigService } from "../config/api-config.service";
import { runs, runEvents } from "../database/schema";
import type { RunKernelFactory } from "./run-kernel.factory";
import { RUN_KERNEL_FACTORY } from "./run-kernel.factory";

type RunInsertRow = typeof runs.$inferInsert;
type RunRowType = typeof runs.$inferSelect;
type RunPatch = Partial<Omit<RunRowType, "id">>;
type RunEventInsertRow = typeof runEvents.$inferInsert;

export type RunStatus = "running" | "completed" | "awaiting_input" | "no_plan" | "failed";

export interface RunSummary {
  id: string;
  status: RunStatus;
  task?: string;
  reason?: string | null;
  startedAt: string;
  finishedAt?: string | null;
  updatedAt: string;
  stepCount: number;
  finalResult?: any;
}

export interface RunEventDto {
  id: string;
  runId: string;
  ts: string;
  type: string;
  topic?: string | null;
  level?: string | null;
  data: any;
  spanId?: string | null;
  parentSpanId?: string | null;
  version?: number | null;
  lineNumber?: number | null;
}

interface StartRunRequest {
  message: string;
  history: ChatMessage[];
  traceId?: string;
  budget?: RunLoopBudget;
}

interface StreamEvent {
  type: string;
  data: any;
}

function normaliseMessage(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (raw && typeof raw === "object" && typeof (raw as any).content === "string") {
    return (raw as any).content;
  }
  return "";
}

function normaliseHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const history: ChatMessage[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const role = typeof (entry as any).role === "string" ? (entry as any).role : undefined;
    const content = typeof (entry as any).content === "string" ? (entry as any).content : undefined;
    if (role && content) {
      history.push({ role, content });
    }
  }
  return history;
}

function parseNumeric(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normaliseBudget(raw: unknown): RunLoopBudget | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const source = raw as Record<string, unknown>;
  const budget: RunLoopBudget = {};

  const stepKeys = ["maxSteps", "max_steps", "stepLimit", "step_limit", "steps"];
  for (const key of stepKeys) {
    const value = parseNumeric(source[key]);
    if (value !== undefined) {
      budget.maxSteps = value;
      break;
    }
  }

  const costKeys = ["maxCost", "max_cost", "costLimit", "cost_limit", "limit", "usd", "budget"];
  for (const key of costKeys) {
    const value = parseNumeric(source[key]);
    if (value !== undefined) {
      budget.maxCost = value;
      break;
    }
  }

  const latencyKeys = [
    "maxLatencyMs",
    "max_latency_ms",
    "latencyLimitMs",
    "latency_limit_ms",
    "tool_latency_limit_ms",
  ];
  for (const key of latencyKeys) {
    const value = parseNumeric(source[key]);
    if (value !== undefined) {
      budget.maxLatencyMs = value;
      break;
    }
  }

  return Object.keys(budget).length > 0 ? budget : undefined;
}

@Injectable()
export class RunsService {
  private readonly logger = new Logger(RunsService.name);
  private readonly streams = new Map<string, ReplaySubject<StreamEvent>>();

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ApiConfigService) private readonly config: ApiConfigService,
    @Inject(RUN_KERNEL_FACTORY) private readonly kernelFactory: RunKernelFactory,
  ) {}

  async startRun(payload: any): Promise<{ runId: string }> {
    const request: StartRunRequest = {
      message: normaliseMessage(payload?.message ?? payload?.input ?? ""),
      history: normaliseHistory(payload?.messages ?? payload?.history),
      traceId: typeof payload?.trace_id === "string" ? payload.trace_id : undefined,
      budget:
        payload && typeof payload === "object"
          ? normaliseBudget((payload as Record<string, unknown>).budget)
          : undefined,
    };

    const runId = request.traceId && request.traceId.length > 0 ? request.traceId : randomUUID();
    const now = new Date();

    const runRecord: RunInsertRow = {
      id: runId,
      status: "running" as const,
      task: request.message || undefined,
      input: request.message || undefined,
      reason: null,
      finalResult: null,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
      stepCount: 0,
    };

    if (this.database.isMemoryMode()) {
      this.database.insertRun(runRecord);
    } else {
      await this.database.db!.insert(runs).values(runRecord).onConflictDoNothing().run();
    }

    this.recordSyntheticEvent(runId, "run.started", {
      runId,
      message: request.message,
      budget: request.budget ?? null,
    }).catch(
      (error) => {
        this.logger.error(`failed to persist run.started event for ${runId}`, error as Error);
      },
    );

    this.executeRun(runId, request).catch((error) => {
      this.logger.error(`run ${runId} crashed`, error as Error);
      this.handleRunFailure(runId, error).catch((err) => {
        this.logger.error(`failed to handle run failure for ${runId}`, err as Error);
      });
    });

    return { runId };
  }

  async getRun(runId: string): Promise<RunSummary> {
    const row = this.database.isMemoryMode()
      ? this.database.getRun(runId)
      : this.database.db!.select().from(runs).where(eq(runs.id, runId)).get();
    if (!row) {
      throw new NotFoundException(`run ${runId} not found`);
    }
    return this.mapRun(row);
  }

  async getRunEvents(runId: string, since?: number): Promise<RunEventDto[]> {
    const rows = this.database.isMemoryMode()
      ? this.database.listRunEvents(runId, since)
      : this.database
          .db!.select()
          .from(runEvents)
          .where(
            typeof since === "number" && Number.isFinite(since)
              ? and(eq(runEvents.runId, runId), gt(runEvents.ts, new Date(since)))
              : eq(runEvents.runId, runId),
          )
          .orderBy(runEvents.ts)
          .all();

    return rows.map((row) => this.mapEvent(row));
  }

  stream(runId: string): Observable<StreamEvent> {
    let subject = this.streams.get(runId);
    if (!subject) {
      subject = new ReplaySubject<StreamEvent>();
      this.streams.set(runId, subject);
    }
    return subject.asObservable();
  }

  private async executeRun(runId: string, request: StartRunRequest): Promise<void> {
    const eventBus = new EventBus();
    const logger = new EpisodeLogger({ traceId: runId, dir: this.config.episodesDir });

    eventBus.subscribe(async (event) => {
      try {
        await logger.append(event);
      } catch (error) {
        this.logger.warn(`failed to append episode event for ${runId}`, error as Error);
      }
      await this.persistEvent(runId, event);
    });

    const history = request.history ?? [];

    const kernel = await this.kernelFactory.createKernel({
      traceId: runId,
      message: request.message,
      history,
      eventBus,
    });

    const emit = async (event: CoreEvent, span?: EmitSpanOptions): Promise<void> => {
      await eventBus.publish(wrapCoreEvent(runId, event, span));
    };

    const publishChatMessage = async (
      role: string,
      text: string,
      options: { replyTo?: string } = {},
    ): Promise<string> => {
      const msgId = randomUUID();
      await eventBus.publish({
        id: randomUUID(),
        ts: new Date().toISOString(),
        type: "agent.chat.msg",
        version: 1,
        trace_id: runId,
        data: {
          msg_id: msgId,
          role,
          text,
          trace_id: runId,
          ...(options.replyTo ? { reply_to: options.replyTo } : {}),
        },
      });
      return msgId;
    };

    let lastUserMessageId: string | undefined;
    for (const entry of history) {
      const replyTo = entry.role === "assistant" ? lastUserMessageId : undefined;
      const msgId = await publishChatMessage(entry.role, entry.content, { replyTo });
      if (entry.role === "user") {
        lastUserMessageId = msgId;
      }
    }

    if (request.message) {
      lastUserMessageId = await publishChatMessage("user", request.message, {
        replyTo: lastUserMessageId,
      });
    }

    try {
      const result = await runLoop(kernel, emit, {
        context: { traceId: runId, input: request.message },
        budget: request.budget,
      });
      if (result.reason === "terminated" && result.termination) {
        await eventBus.publish(
          createRunEvent(
            runId,
            "guardian.alert",
            {
              runId,
              reason: result.termination.reason,
              limit: result.termination.limit,
              metrics: result.termination.metrics,
            },
            { level: "warn" },
          ),
        );
      }
      await this.handleRunCompletion(runId, result);
    } catch (error) {
      await this.handleRunFailure(runId, error);
    }
  }

  private async handleRunCompletion(runId: string, result: RunLoopResult): Promise<void> {
    const status = this.mapRunStatus(result.reason);
    const finishedAt = new Date();
    const finalJson = result.final != null ? JSON.stringify(result.final) : null;
    const resolvedReason =
      result.reason === "terminated"
        ? `terminated:${result.termination?.reason ?? "budget"}`
        : result.reason;

    const completionPatch: RunPatch = {
      status,
      reason: resolvedReason,
      finalResult: finalJson,
      finishedAt,
      updatedAt: finishedAt,
      stepCount: result.metrics.stepCount,
    };

    if (this.database.isMemoryMode()) {
      this.database.updateRun(runId, completionPatch);
    } else {
      await this.database.db!.update(runs).set(completionPatch).where(eq(runs.id, runId)).run();
    }

    await this.recordSyntheticEvent(runId, "run.finished", {
      runId,
      status,
      reason: result.reason,
      review: result.review ?? null,
      final: result.final ?? null,
      metrics: result.metrics,
      termination: result.termination ?? null,
    });

    this.completeStream(runId);
  }

  private async handleRunFailure(runId: string, error: unknown): Promise<void> {
    const finishedAt = new Date();
    const message = error instanceof Error ? error.message : "unknown error";
    const failurePatch: RunPatch = {
      status: "failed",
      reason: message,
      finishedAt,
      updatedAt: finishedAt,
    };

    if (this.database.isMemoryMode()) {
      this.database.updateRun(runId, failurePatch);
    } else {
      await this.database.db!.update(runs).set(failurePatch).where(eq(runs.id, runId)).run();
    }

    await this.recordSyntheticEvent(runId, "run.failed", {
      runId,
      error: {
        message,
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      },
    });

    this.completeStream(runId);
  }

  private completeStream(runId: string): void {
    const stream = this.streams.get(runId);
    if (stream) {
      stream.complete();
      this.streams.delete(runId);
    }
  }

  private async recordSyntheticEvent(runId: string, type: string, data: any): Promise<void> {
    const envelope: EventEnvelope = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      type,
      version: 1,
      trace_id: runId,
      data,
    };
    await this.persistEvent(runId, envelope);
  }

  private async persistEvent(runId: string, envelope: EventEnvelope): Promise<void> {
    const timestamp = envelope.ts ? new Date(envelope.ts) : new Date();
    const payloadJson = envelope.data != null ? JSON.stringify(envelope.data) : null;

    const eventRecord: RunEventInsertRow = {
      id: envelope.id,
      runId,
      ts: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
      eventType: envelope.type,
      topic: envelope.topic ?? null,
      level: envelope.level ?? null,
      payload: payloadJson,
      spanId: envelope.span_id ?? null,
      parentSpanId: envelope.parent_span_id ?? null,
      version: envelope.version ?? null,
      lineNumber: envelope.ln ?? null,
    };

    if (this.database.isMemoryMode()) {
      this.database.insertRunEvent(eventRecord);
      this.database.updateRun(runId, { updatedAt: new Date() });
    } else {
      await this.database.db!.insert(runEvents).values(eventRecord).onConflictDoNothing().run();

      await this.database
        .db!.update(runs)
        .set({ updatedAt: new Date() })
        .where(eq(runs.id, runId))
        .run();
    }

    const streamEvent: StreamEvent = {
      type: envelope.type,
      data: {
        id: envelope.id,
        ts: envelope.ts,
        type: envelope.type,
        data: envelope.data,
        span_id: envelope.span_id,
        parent_span_id: envelope.parent_span_id,
        topic: envelope.topic,
        level: envelope.level,
        version: envelope.version,
      },
    };

    let subject = this.streams.get(runId);
    if (!subject) {
      subject = new ReplaySubject<StreamEvent>();
      this.streams.set(runId, subject);
    }
    subject.next(streamEvent);
  }

  private mapRun(row: typeof runs.$inferSelect): RunSummary {
    let finalResult: any;
    if (row.finalResult) {
      try {
        finalResult = JSON.parse(row.finalResult);
      } catch {
        finalResult = row.finalResult;
      }
    }
    return {
      id: row.id,
      status: row.status as RunStatus,
      task: row.task ?? undefined,
      reason: row.reason,
      startedAt: new Date(row.startedAt).toISOString(),
      finishedAt: row.finishedAt ? new Date(row.finishedAt).toISOString() : null,
      updatedAt: new Date(row.updatedAt).toISOString(),
      stepCount: row.stepCount ?? 0,
      finalResult,
    };
  }

  private mapEvent(row: typeof runEvents.$inferSelect): RunEventDto {
    let data: any = null;
    if (row.payload) {
      try {
        data = JSON.parse(row.payload);
      } catch {
        data = row.payload;
      }
    }
    return {
      id: row.id,
      runId: row.runId,
      ts: new Date(row.ts).toISOString(),
      type: row.eventType,
      topic: row.topic ?? null,
      level: row.level ?? null,
      data,
      spanId: row.spanId ?? null,
      parentSpanId: row.parentSpanId ?? null,
      version: row.version ?? null,
      lineNumber: row.lineNumber ?? null,
    };
  }

  private mapRunStatus(reason: RunLoopResult["reason"]): RunStatus {
    switch (reason) {
      case "completed":
        return "completed";
      case "ask":
        return "awaiting_input";
      case "no-plan":
        return "no_plan";
      default:
        return "failed";
    }
  }
}

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  type ReviewStatus,
  type SkillRecord,
  getSkillById,
  resetSkillsStore,
  upsertSkills,
} from "./storage";

export interface ToolCallEvent {
  id: string;
  traceId: string;
  toolName: string;
  timestamp: string;
  spanId?: string;
  parentSpanId?: string;
  callId?: string;
  input?: unknown;
  output?: unknown;
  success: boolean;
  error?: string;
  tags?: string[];
  category?: string;
  metadata?: Record<string, unknown>;
}

export interface AggregatedToolCall {
  toolName: string;
  category?: string;
  tags: string[];
  totalCount: number;
  successCount: number;
  failureCount: number;
  events: ToolCallEvent[];
  lastTimestamp?: string;
}

export interface SkillDraft {
  id: string;
  name: string;
  description: string;
  template: Record<string, unknown>;
  tags?: string[];
  category?: string;
}

export interface SkillSummariser {
  summarise(group: AggregatedToolCall): Promise<SkillDraft>;
}

export interface EventsRepository {
  listToolEvents(options?: { since?: string }): Promise<ToolCallEvent[]>;
}

export interface SkillsRepository {
  list(): Promise<SkillRecord[]>;
  findById(id: string): Promise<SkillRecord | null>;
  upsert(records: SkillRecord[]): Promise<SkillRecord[]>;
}

export interface SkillAnalysisPipelineOptions {
  minSamplesForReview?: number;
  clock?: () => Date;
}

export interface SkillAnalysisResult {
  analyzedEvents: number;
  aggregated: AggregatedToolCall[];
  candidates: SkillRecord[];
  updatedSkills: SkillRecord[];
}

const DEFAULT_MIN_SAMPLES_FOR_REVIEW = 3;

function stableClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null));
}

function eventKey(event: ToolCallEvent): string {
  return event.callId ?? `${event.traceId}:${event.spanId ?? ""}:${event.toolName}:${event.id}`;
}

function mergeTags(...sets: (string[] | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const set of sets) {
    if (!set) continue;
    for (const tag of set) {
      if (typeof tag === "string" && tag.trim()) {
        seen.add(tag.trim());
      }
    }
  }
  return [...seen];
}

function titleCaseFromSlug(value: string): string {
  return value
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

interface ExistingAnalysisMetadata {
  eventIds: Set<string>;
  successCount: number;
  failureCount: number;
  sampleEvents: SampleEvent[];
}

interface SampleEvent {
  input?: unknown;
  output?: unknown;
  success: boolean;
  timestamp?: string;
  traceId?: string;
}

function extractAnalysisMetadata(record: SkillRecord | null): ExistingAnalysisMetadata {
  const template = record?.template_json as Record<string, unknown> | undefined;
  const analysis = template && typeof template === "object" ? (template.analysis as any) : undefined;
  const eventIds = new Set<string>();
  const sampleEvents: SampleEvent[] = [];
  let successCount = 0;
  let failureCount = 0;

  if (analysis && typeof analysis === "object") {
    const ids: unknown = analysis.event_ids;
    if (Array.isArray(ids)) {
      for (const id of ids) {
        if (typeof id === "string" && id.length > 0) {
          eventIds.add(id);
        }
      }
    }
    const storedSamples: unknown = analysis.sample_events;
    if (Array.isArray(storedSamples)) {
      for (const entry of storedSamples) {
        if (!entry || typeof entry !== "object") continue;
        sampleEvents.push({
          input: (entry as any).input,
          output: (entry as any).output,
          success: Boolean((entry as any).success),
          timestamp: typeof (entry as any).timestamp === "string" ? (entry as any).timestamp : undefined,
          traceId: typeof (entry as any).trace_id === "string" ? (entry as any).trace_id : undefined,
        });
      }
    }
    const storedSuccess = Number((analysis as any).success_count);
    const storedFailure = Number((analysis as any).failure_count);
    if (Number.isFinite(storedSuccess) && storedSuccess >= 0) {
      successCount = storedSuccess;
    }
    if (Number.isFinite(storedFailure) && storedFailure >= 0) {
      failureCount = storedFailure;
    }
  }

  return { eventIds, sampleEvents, successCount, failureCount };
}

function buildAnalysisPayload(
  existing: ExistingAnalysisMetadata,
  additions: {
    newEventIds: string[];
    newSamples: SampleEvent[];
    successCount: number;
    failureCount: number;
  },
): Record<string, unknown> {
  const combinedIds = new Set(existing.eventIds);
  for (const id of additions.newEventIds) {
    combinedIds.add(id);
  }
  const combinedSamples = [...existing.sampleEvents];
  for (const sample of additions.newSamples) {
    combinedSamples.push(sample);
  }
  while (combinedSamples.length > 5) {
    combinedSamples.shift();
  }
  const totalSuccess = existing.successCount + additions.successCount;
  const totalFailure = existing.failureCount + additions.failureCount;
  return {
    event_ids: [...combinedIds],
    success_count: totalSuccess,
    failure_count: totalFailure,
    sample_events: combinedSamples.map((sample) => ({
      ...sample,
      timestamp: sample.timestamp,
      trace_id: sample.traceId,
    })),
  } satisfies Record<string, unknown>;
}

export class HeuristicSkillSummariser implements SkillSummariser {
  async summarise(group: AggregatedToolCall): Promise<SkillDraft> {
    const baseName = group.toolName;
    const title = `${titleCaseFromSlug(baseName)} Skill`;
    const successRate = group.totalCount === 0 ? 0 : group.successCount / group.totalCount;
    const description =
      group.totalCount === 0
        ? `Draft capability for ${baseName}.`
        : `Automates ${baseName} based on ${group.totalCount} observed calls with ${(successRate * 100).toFixed(0)}% success.`;

    const sample = group.events[0];
    const template: Record<string, unknown> = {
      tool: {
        name: baseName,
        ...(group.category ? { category: group.category } : {}),
      },
      expectations: {
        success_rate: successRate,
        total_observations: group.totalCount,
      },
      examples: group.events.slice(0, 3).map((evt) => ({
        input: stableClone(evt.input ?? null),
        output: stableClone(evt.output ?? null),
        success: evt.success,
        trace_id: evt.traceId,
        timestamp: evt.timestamp,
      })),
      ...(sample?.metadata ? { metadata: stableClone(sample.metadata) } : {}),
    };

    return {
      id: baseName,
      name: title,
      description,
      template,
      tags: mergeTags(group.tags),
      category: group.category,
    } satisfies SkillDraft;
  }
}

export class FileEventsRepository implements EventsRepository {
  constructor(private readonly filePath = process.env.AOS_EVENTS_PATH ?? join(process.cwd(), "runtime", "events.json")) {}

  async listToolEvents(): Promise<ToolCallEvent[]> {
    try {
      const payload = await readFile(this.filePath, "utf8");
      if (!payload) {
        return [];
      }
      const parsed = JSON.parse(payload);
      if (!Array.isArray(parsed)) {
        return [];
      }
      const events: ToolCallEvent[] = [];
      for (const entry of parsed) {
        const normalised = normaliseEvent(entry);
        if (normalised) {
          events.push(normalised);
        }
      }
      return events;
    } catch (error: any) {
      if (error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
}

function normaliseEvent(raw: unknown): ToolCallEvent | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const data = raw as Record<string, unknown>;
  const id = typeof data.id === "string" ? data.id : null;
  const toolName = typeof data.toolName === "string" ? data.toolName : typeof data.tool_name === "string" ? data.tool_name : null;
  const traceId = typeof data.traceId === "string" ? data.traceId : typeof data.trace_id === "string" ? data.trace_id : null;
  const timestamp = typeof data.timestamp === "string" ? data.timestamp : typeof data.ts === "string" ? data.ts : new Date().toISOString();
  if (!id || !toolName || !traceId) {
    return null;
  }
  const spanId = typeof data.spanId === "string" ? data.spanId : typeof data.span_id === "string" ? data.span_id : undefined;
  const parentSpanId =
    typeof data.parentSpanId === "string"
      ? data.parentSpanId
      : typeof data.parent_span_id === "string"
        ? data.parent_span_id
        : undefined;
  const callId = typeof data.callId === "string" ? data.callId : typeof data.call_id === "string" ? data.call_id : undefined;
  const successRaw = data.success;
  const success = typeof successRaw === "boolean" ? successRaw : successRaw === 1;
  const tags = Array.isArray(data.tags)
    ? (data.tags as unknown[]).filter((tag): tag is string => typeof tag === "string")
    : undefined;
  const category = typeof data.category === "string" ? data.category : undefined;

  return {
    id,
    traceId,
    toolName,
    timestamp,
    spanId,
    parentSpanId,
    callId,
    input: (data.input ?? data.args ?? data.parameters) as unknown,
    output: (data.output ?? data.result) as unknown,
    success,
    error: typeof data.error === "string" ? data.error : undefined,
    tags,
    category,
    metadata: typeof data.metadata === "object" ? (data.metadata as Record<string, unknown>) : undefined,
  } satisfies ToolCallEvent;
}

export class FileSkillsRepository implements SkillsRepository {
  async list(): Promise<SkillRecord[]> {
    return listSkills();
  }

  async findById(id: string): Promise<SkillRecord | null> {
    return getSkillById(id);
  }

  async upsert(records: SkillRecord[]): Promise<SkillRecord[]> {
    return upsertSkills(records);
  }
}

export class InMemoryEventsRepository implements EventsRepository {
  private events: ToolCallEvent[];

  constructor(events: ToolCallEvent[] = []) {
    this.events = events.map((event) => ({ ...event }));
  }

  async listToolEvents(): Promise<ToolCallEvent[]> {
    return this.events.map((event) => ({ ...event }));
  }

  setEvents(events: ToolCallEvent[]): void {
    this.events = events.map((event) => ({ ...event }));
  }
}

export class InMemorySkillsRepository implements SkillsRepository {
  private records: SkillRecord[];

  constructor(records: SkillRecord[] = []) {
    this.records = records.map((record) => ({ ...record, template_json: stableClone(record.template_json) }));
  }

  async list(): Promise<SkillRecord[]> {
    return this.records.map((record) => ({ ...record, template_json: stableClone(record.template_json) }));
  }

  async findById(id: string): Promise<SkillRecord | null> {
    const match = this.records.find((record) => record.id === id);
    return match ? { ...match, template_json: stableClone(match.template_json) } : null;
  }

  async upsert(records: SkillRecord[]): Promise<SkillRecord[]> {
    for (const record of records) {
      const index = this.records.findIndex((existing) => existing.id === record.id);
      const cloned = { ...record, template_json: stableClone(record.template_json) };
      if (index >= 0) {
        this.records[index] = cloned;
      } else {
        this.records.push(cloned);
      }
    }
    return this.list();
  }
}

export class SkillAnalysisPipeline {
  private readonly minSamplesForReview: number;
  private readonly now: () => Date;

  constructor(
    private readonly eventsRepository: EventsRepository,
    private readonly skillsRepository: SkillsRepository,
    private readonly summariser: SkillSummariser,
    options: SkillAnalysisPipelineOptions = {},
  ) {
    this.minSamplesForReview = options.minSamplesForReview ?? DEFAULT_MIN_SAMPLES_FOR_REVIEW;
    this.now = options.clock ?? (() => new Date());
  }

  async run(): Promise<SkillAnalysisResult> {
    const events = await this.eventsRepository.listToolEvents();
    const deduped = this.deduplicate(events);
    const aggregated = this.aggregate(deduped);

    const updatedRecords: SkillRecord[] = [];

    for (const group of aggregated) {
      if (group.totalCount === 0) {
        continue;
      }
      const draft = await this.summariser.summarise(group);
      const existing = await this.skillsRepository.findById(draft.id);
      const updated = this.mergeWithExisting(group, draft, existing);
      updatedRecords.push(updated);
    }

    const updatedList =
      updatedRecords.length > 0
        ? await this.skillsRepository.upsert(updatedRecords)
        : await this.skillsRepository.list();

    const candidates = updatedList.filter((skill) => skill.review_status !== "approved");

    return {
      analyzedEvents: deduped.length,
      aggregated,
      candidates,
      updatedSkills: updatedList,
    } satisfies SkillAnalysisResult;
  }

  private deduplicate(events: ToolCallEvent[]): ToolCallEvent[] {
    const seen = new Set<string>();
    const result: ToolCallEvent[] = [];
    for (const event of events) {
      const key = eventKey(event);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(event);
    }
    return result;
  }

  private aggregate(events: ToolCallEvent[]): AggregatedToolCall[] {
    const groups = new Map<string, AggregatedToolCall>();
    for (const event of events) {
      const key = event.toolName;
      let group = groups.get(key);
      if (!group) {
        group = {
          toolName: event.toolName,
          category: event.category,
          tags: mergeTags(event.tags),
          totalCount: 0,
          successCount: 0,
          failureCount: 0,
          events: [],
          lastTimestamp: event.timestamp,
        } satisfies AggregatedToolCall;
        groups.set(key, group);
      }
      group.totalCount += 1;
      if (event.success) {
        group.successCount += 1;
      } else {
        group.failureCount += 1;
      }
      group.events.push({ ...event });
      group.tags = mergeTags(group.tags, event.tags);
      if (!group.category && event.category) {
        group.category = event.category;
      }
      if (!group.lastTimestamp || event.timestamp > group.lastTimestamp) {
        group.lastTimestamp = event.timestamp;
      }
    }
    return [...groups.values()];
  }

  private mergeWithExisting(
    group: AggregatedToolCall,
    draft: SkillDraft,
    existing: SkillRecord | null,
  ): SkillRecord {
    const metadata = extractAnalysisMetadata(existing);
    const now = this.now().toISOString();
    const newEvents = group.events.filter((event) => !metadata.eventIds.has(eventKey(event)));
    const newEventIds = newEvents.map((event) => eventKey(event));
    const newSuccess = newEvents.filter((event) => event.success).length;
    const newFailure = newEvents.length - newSuccess;

    const analysis = buildAnalysisPayload(metadata, {
      newEventIds,
      newSamples: newEvents.slice(0, 3).map((evt) => ({
        input: stableClone(evt.input ?? null),
        output: stableClone(evt.output ?? null),
        success: evt.success,
        timestamp: evt.timestamp,
        traceId: evt.traceId,
      })),
      successCount: newSuccess,
      failureCount: newFailure,
    });

    const totalSuccess = metadata.successCount + newSuccess;
    const totalFailure = metadata.failureCount + newFailure;
    const totalCount = totalSuccess + totalFailure;

    const template = {
      ...stableClone(existing?.template_json ?? {}),
      ...stableClone(draft.template),
      analysis,
    } as Record<string, unknown>;

    const reviewStatus = this.determineReviewStatus(existing?.review_status, totalCount);

    const tags = mergeTags(existing?.tags, draft.tags, group.tags);

    return {
      id: draft.id,
      name: draft.name,
      description: draft.description,
      category: draft.category ?? existing?.category,
      tags,
      enabled: existing?.enabled ?? false,
      template_json: template,
      used_count: totalCount,
      win_rate: totalCount === 0 ? 0 : totalSuccess / totalCount,
      review_status: reviewStatus,
      last_analyzed_at: now,
    } satisfies SkillRecord;
  }

  private determineReviewStatus(current: ReviewStatus | undefined, usedCount: number): ReviewStatus {
    if (current === "approved" || current === "rejected") {
      return current;
    }
    if (usedCount >= this.minSamplesForReview) {
      return "pending_review";
    }
    return current ?? "draft";
  }
}

export async function runDefaultSkillAnalysis(
  summariser: SkillSummariser = new HeuristicSkillSummariser(),
  options: SkillAnalysisPipelineOptions = {},
): Promise<SkillAnalysisResult> {
  const eventsRepo = new FileEventsRepository();
  const skillsRepo = new FileSkillsRepository();
  const pipeline = new SkillAnalysisPipeline(eventsRepo, skillsRepo, summariser, options);
  return pipeline.run();
}

export { resetSkillsStore };

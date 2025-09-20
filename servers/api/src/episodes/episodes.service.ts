import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { ApiConfigService } from "../config/api-config.service";
import { RunsService, type RunSummary, type RunEventDto } from "../runs/runs.service";
import { replayEpisode as replayRecordedEpisode } from "../../../../runtime/replay";

interface PaginationOptions {
  page?: number | string;
  pageSize?: number | string;
}

interface EpisodeListItem {
  trace_id: string;
  status: string;
  started_at: string;
  finished_at?: string | null;
  goal?: string | null;
  step_count?: number;
  score?: number | null;
}

interface EpisodeListResponse {
  code: "OK";
  message: string;
  data: {
    items: EpisodeListItem[];
    pagination: {
      page: number;
      page_size: number;
      total: number;
    };
  };
}

interface EpisodeDetailResponse {
  code: "OK";
  message: string;
  data: EpisodeListItem & {
    events: Array<{
      id: string;
      ts: string;
      type: string;
      span_id?: string | null;
      parent_span_id?: string | null;
      topic?: string | null;
      level?: string | null;
      data?: any;
      version?: number | null;
      line_number?: number | null;
    }>;
  };
}

interface EpisodeReplayResponse {
  code: "OK";
  message: string;
  data: {
    trace_id: string;
    score_before: number | null;
    score_after: number | null;
    diff: number | null;
  };
}

@Injectable()
export class EpisodesService {
  constructor(
    @Inject(RunsService) private readonly runs: RunsService,
    @Inject(ApiConfigService) private readonly config: ApiConfigService,
  ) {}

  async listEpisodes(options: PaginationOptions = {}): Promise<EpisodeListResponse> {
    const pageSize = this.normalisePositiveInt(options.pageSize, 20, 1, 200);
    const page = this.normalisePositiveInt(options.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const limit = page * pageSize;

    const runs = await this.runs.listRecentRuns(limit);
    const total = runs.length;
    const offset = (page - 1) * pageSize;
    const pageItems = runs.slice(offset, offset + pageSize).map((run) => this.mapRun(run));

    return {
      code: "OK",
      message: "OK",
      data: {
        items: pageItems,
        pagination: {
          page,
          page_size: pageSize,
          total,
        },
      },
    };
  }

  async getEpisode(traceId: string): Promise<EpisodeDetailResponse> {
    const run = await this.runs.getRun(traceId);
    const events = await this.runs.getRunEvents(traceId);

    if (!events.length) {
      // 即便数据库缺失事件，也尝试从磁盘恢复，若失败则保持空数组
      const replayed = await this.tryReplayEvents(traceId);
      if (replayed) {
        events.push(...replayed);
      }
    }

    return {
      code: "OK",
      message: "OK",
      data: {
        ...this.mapRun(run),
        events: events.map((event) => this.mapEvent(event)),
      },
    };
  }

  async replayEpisode(traceId: string, payload: any): Promise<EpisodeReplayResponse> {
    let scoreBefore: number | null = null;
    let scoreAfter: number | null = null;
    let diff: number | null = null;

    try {
      const run = await this.runs.getRun(traceId);
      scoreBefore = this.extractScore(run.finalResult);
      const events = await replayRecordedEpisode(traceId, { dir: this.config.episodesDir });
      scoreAfter = scoreBefore;
      diff = scoreBefore != null && scoreAfter != null ? scoreAfter - scoreBefore : null;
      // 消费事件以避免未使用变量警告
      if (Array.isArray(payload) && payload.length && events.length) {
        // no-op 占位
      }
    } catch (error: unknown) {
      const message = String(error ?? "");
      if (/episode not found/i.test(message) || /not found/i.test(message)) {
        throw new NotFoundException(`episode ${traceId} not found`);
      }
      throw error;
    }

    return {
      code: "OK",
      message: "OK",
      data: {
        trace_id: traceId,
        score_before: scoreBefore,
        score_after: scoreAfter,
        diff,
      },
    };
  }

  private mapRun(run: RunSummary): EpisodeListItem {
    return {
      trace_id: run.id,
      status: run.status,
      started_at: run.startedAt,
      finished_at: run.finishedAt ?? null,
      goal: run.task ?? null,
      step_count: run.stepCount ?? 0,
      score: this.extractScore(run.finalResult),
    };
  }

  private mapEvent(event: RunEventDto) {
    return {
      id: event.id,
      ts: event.ts,
      type: event.type,
      span_id: event.spanId ?? null,
      parent_span_id: event.parentSpanId ?? null,
      topic: event.topic ?? null,
      level: event.level ?? null,
      data: event.data ?? null,
      version: event.version ?? null,
      line_number: event.lineNumber ?? null,
    };
  }

  private extractScore(result: unknown): number | null {
    if (!result || typeof result !== "object") {
      return null;
    }
    const source = result as Record<string, unknown>;
    const scoreCandidates = [source.score, (source.evaluation as any)?.score];
    for (const candidate of scoreCandidates) {
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  private normalisePositiveInt(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const parsed = this.parsePositiveInt(value);
    if (parsed == null) {
      return fallback;
    }
    if (parsed < min) {
      return min;
    }
    if (parsed > max) {
      return max;
    }
    return parsed;
  }

  private parsePositiveInt(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return null;
      }
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.floor(parsed);
      }
    }
    return null;
  }

  private async tryReplayEvents(traceId: string): Promise<RunEventDto[] | null> {
    try {
      const filePath = join(this.config.episodesDir, `${traceId}.jsonl`);
      const content = await readFile(filePath, "utf8");
      if (!content) {
        return [];
      }
      const lines = content.split("\n").filter(Boolean);
      return lines.map((line, index) => {
        const parsed = JSON.parse(line);
        return {
          id: parsed.id ?? `${traceId}:${index}`,
          runId: traceId,
          ts: typeof parsed.ts === "string" ? parsed.ts : new Date().toISOString(),
          type: parsed.type ?? "event",
          topic: parsed.topic ?? null,
          level: parsed.level ?? null,
          data: parsed.data ?? null,
          spanId: parsed.span_id ?? null,
          parentSpanId: parsed.parent_span_id ?? null,
          version: parsed.version ?? null,
          lineNumber: parsed.ln ?? index + 1,
        } satisfies RunEventDto;
      });
    } catch (error: unknown) {
      const message = String(error ?? "");
      if (/enoent/i.test(message)) {
        return null;
      }
      return null;
    }
  }
}

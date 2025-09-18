import "reflect-metadata";
import { Controller, Get, Param, Query, Sse, UseGuards } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { from, interval, merge } from "rxjs";
import { endWith, ignoreElements, map, takeUntil } from "rxjs/operators";
import { RunsService } from "./runs.service";
import { ApiKeyGuard } from "../auth/api-key.guard";

@Controller("runs")
export class RunsController {
  constructor(private readonly runs: RunsService) {}

  @Get(":runId")
  async getRun(@Param("runId") runId: string) {
    return this.runs.getRun(runId);
  }

  @Get(":runId/events")
  async getRunEvents(@Param("runId") runId: string, @Query("since") since?: string) {
    const sinceMs = since ? Date.parse(since) : undefined;
    const value = typeof sinceMs === "number" && !Number.isNaN(sinceMs) ? sinceMs : undefined;
    const events = await this.runs.getRunEvents(runId, value);
    return { events };
  }

  @Sse(":runId/stream")
  @UseGuards(ApiKeyGuard)
  async stream(@Param("runId") runId: string) {
    const events = await this.runs.getRunEvents(runId);
    const history$ = from(events).pipe(
      map(
        (event) =>
          ({
            type: event.type,
            data: {
              id: event.id,
              ts: event.ts,
              type: event.type,
              data: event.data,
              span_id: event.spanId,
              parent_span_id: event.parentSpanId,
              topic: event.topic,
              level: event.level,
              version: event.version,
            },
          }) satisfies MessageEvent,
      ),
    );
    const stream$ = this.runs.stream(runId);
    const live$ = stream$.pipe(
      map((event) => ({ type: event.type, data: event.data }) satisfies MessageEvent),
    );
    const heartbeat$ = interval(15000).pipe(
      map(
        () =>
          ({ type: "heartbeat", data: { ts: new Date().toISOString() } }) satisfies MessageEvent,
      ),
      takeUntil(stream$.pipe(ignoreElements(), endWith(null))),
    );
    return merge(history$, live$, heartbeat$);
  }
}

import "reflect-metadata";
import type { NextApiRequest, NextApiResponse } from "next";
import { NestFactory } from "@nestjs/core";
import type { INestApplicationContext } from "@nestjs/common";

import { AppModule } from "../../servers/api/src/app.module";
import { RunsService } from "../../servers/api/src/runs/runs.service";
import type { RunEventDto } from "../../servers/api/src/runs/runs.service";

interface RunStartResponse {
  runId?: string;
  run_id?: string;
}

interface RunSummaryResponse {
  status?: string;
  reason?: string | null;
  finalResult?: unknown;
  final_result?: unknown;
}

interface RunEventsResponse {
  events?: Array<{
    id: string;
    ts: string;
    type: string;
    span_id?: string | null;
    parent_span_id?: string | null;
    topic?: string | null;
    level?: string | null;
    version?: number | null;
    data?: unknown;
  }>;
}

export interface RunApiResponse {
  trace_id: string;
  status?: string;
  reason?: string | null;
  result?: unknown;
  events: Array<{
    id: string;
    ts: string;
    type: string;
    span_id?: string | null;
    parent_span_id?: string | null;
    topic?: string | null;
    level?: string | null;
    version?: number | null;
    data?: unknown;
  }>;
}

let localAppPromise: Promise<INestApplicationContext> | null = null;

export function resolveApiBaseUrl(): string | null {
  const base = process.env.AOS_API_BASE_URL?.trim();
  if (!base) {
    return null;
  }
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

export function buildAuthHeaders(): Record<string, string> {
  const key = process.env.AOS_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function serialiseEvents(events: RunEventDto[]): RunApiResponse["events"] {
  return events.map((event) => ({
    id: event.id,
    ts: event.ts,
    type: event.type,
    span_id: event.spanId ?? null,
    parent_span_id: event.parentSpanId ?? null,
    topic: event.topic ?? null,
    level: event.level ?? null,
    version: event.version ?? null,
    data: event.data ?? null,
  }));
}

export async function proxyRun(
  apiBase: string,
  payload: any,
  headers: Record<string, string>,
): Promise<RunApiResponse> {
  const startResponse = await fetch(`${apiBase}/agent/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(payload),
  });

  const startJson = await parseJsonSafe<RunStartResponse>(startResponse);
  const runId = startJson?.runId ?? startJson?.run_id;

  if (!startResponse.ok || !runId) {
    const message =
      (startJson as any)?.error?.message ?? `Failed to start run (status ${startResponse.status})`;
    throw new Error(message);
  }

  const [summaryResponse, eventsResponse] = await Promise.all([
    fetch(`${apiBase}/runs/${encodeURIComponent(runId)}`, { headers }).catch(() => null),
    fetch(`${apiBase}/runs/${encodeURIComponent(runId)}/events`, { headers }).catch(() => null),
  ]);

  const summaryJson = summaryResponse
    ? await parseJsonSafe<RunSummaryResponse>(summaryResponse)
    : null;
  const eventsJson = eventsResponse ? await parseJsonSafe<RunEventsResponse>(eventsResponse) : null;

  return {
    trace_id: runId,
    status: summaryJson?.status,
    reason: summaryJson?.reason ?? null,
    result: summaryJson?.finalResult ?? summaryJson?.final_result ?? undefined,
    events: (eventsJson?.events ?? []).map((event) => ({
      id: event.id,
      ts: event.ts,
      type: event.type,
      span_id: event.span_id ?? null,
      parent_span_id: event.parent_span_id ?? null,
      topic: event.topic ?? null,
      level: event.level ?? null,
      version: event.version ?? null,
      data: event.data ?? null,
    })),
  };
}

export async function fetchRemoteRunSummary(
  apiBase: string,
  runId: string,
  headers: Record<string, string>,
): Promise<RunSummaryResponse | null> {
  const response = await fetch(`${apiBase}/runs/${encodeURIComponent(runId)}`, {
    headers,
  });
  if (!response.ok) {
    return null;
  }
  return parseJsonSafe<RunSummaryResponse>(response);
}

export async function fetchRemoteRunEvents(
  apiBase: string,
  runId: string,
  headers: Record<string, string>,
  since?: string,
): Promise<RunEventsResponse | null> {
  const url = new URL(`${apiBase}/runs/${encodeURIComponent(runId)}/events`);
  if (since) {
    url.searchParams.set("since", since);
  }
  const response = await fetch(url, { headers });
  if (!response.ok) {
    return null;
  }
  return parseJsonSafe<RunEventsResponse>(response);
}

export async function getLocalApp(): Promise<INestApplicationContext> {
  if (!localAppPromise) {
    process.env.AOS_USE_IN_MEMORY_DB = process.env.AOS_USE_IN_MEMORY_DB ?? "1";
    localAppPromise = NestFactory.createApplicationContext(AppModule, {
      bufferLogs: true,
    });
  }
  return localAppPromise;
}

export async function runLocally(payload: any): Promise<RunApiResponse> {
  const app = await getLocalApp();
  const runs = app.get(RunsService);
  const { runId } = await runs.startRun(payload);

  const [summary, events] = await Promise.all([
    runs.getRun(runId).catch(() => null),
    runs.getRunEvents(runId).catch(() => []),
  ]);

  return {
    trace_id: runId,
    status: summary?.status,
    reason: summary?.reason ?? null,
    result: summary?.finalResult ?? undefined,
    events: serialiseEvents(events),
  };
}

export async function getLocalRunSummary(runId: string) {
  const app = await getLocalApp();
  const runs = app.get(RunsService);
  return runs.getRun(runId);
}

export async function getLocalRunEvents(runId: string, since?: number) {
  const app = await getLocalApp();
  const runs = app.get(RunsService);
  return runs.getRunEvents(runId, since);
}

export async function getLocalRunStream(runId: string) {
  const app = await getLocalApp();
  const runs = app.get(RunsService);
  const stream = runs.stream(runId);
  const events = await runs.getRunEvents(runId);
  return { stream, events };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: { message: "Method Not Allowed" } });
    return;
  }

  const apiBase = resolveApiBaseUrl();
  const authHeaders = buildAuthHeaders();
  const payload = req.body ?? {};

  try {
    if (apiBase) {
      try {
        const proxied = await proxyRun(apiBase, payload, authHeaders);
        res.status(202).json(proxied);
        return;
      } catch (proxyError) {
        // fall back to local execution below
        // eslint-disable-next-line no-console
        console.warn("/api/run proxy failed, falling back to local execution", proxyError);
      }
    }

    const localResult = await runLocally(payload);
    res.status(202).json(localResult);
  } catch (error: any) {
    const message = error?.message ?? "Failed to reach API server";
    res.status(502).json({ error: { message } });
  }
}

export async function __resetLocalAppForTests(): Promise<void> {
  if (process.env.NODE_ENV !== "test") {
    return;
  }
  if (localAppPromise) {
    const app = await localAppPromise;
    await app.close();
    localAppPromise = null;
  }
}

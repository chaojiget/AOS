const API_BASE = process.env.NEXT_PUBLIC_AOS_BACKEND_URL || 'http://localhost:8080';

export interface LogEntry {
  id: number;
  received_at: string;
  timestamp: string | null;
  trace_id: string | null;
  span_id: string | null;
  parent_span_id: string | null;
  event_type: string | null;
  tags: string[] | null;
  dimensions: Record<string, unknown> | null;
  attributes: Record<string, unknown> | null;
}

export interface TraceListItem {
  trace_id: string;
  event_count: number;
  first_seen: string;
  last_seen: string;
  event_types: string[];
}

export async function fetchLogs(params?: {
  trace_id?: string;
  event_type?: string;
  limit?: number;
  offset?: number;
}): Promise<LogEntry[]> {
  const searchParams = new URLSearchParams();
  if (params?.trace_id) searchParams.set('trace_id', params.trace_id);
  if (params?.event_type) searchParams.set('event_type', params.event_type);
  if (params?.limit) searchParams.set('limit', params.limit.toString());
  if (params?.offset) searchParams.set('offset', params.offset.toString());

  const url = `${API_BASE}/api/v1/telemetry/logs?${searchParams}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch logs: ${res.status}`);
  return res.json();
}

export async function fetchTraces(limit = 50): Promise<TraceListItem[]> {
  const url = `${API_BASE}/api/v1/telemetry/traces?limit=${limit}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch traces: ${res.status}`);
  return res.json();
}

export async function fetchTraceLogs(traceId: string): Promise<LogEntry[]> {
  const url = `${API_BASE}/api/v1/telemetry/logs/${encodeURIComponent(traceId)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch trace logs: ${res.status}`);
  return res.json();
}

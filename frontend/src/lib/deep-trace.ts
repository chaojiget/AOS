import { TelemetryLog, buildSpanForest, shortId } from "@/lib/telemetry";

export type DeepTraceSpanKind = "LLM" | "TOOL" | "CHAIN" | "RETRIEVAL";
export type DeepTraceSpanStatus = "success" | "error";

export type DeepTraceMeta = {
  traceId: string;
  startTimeMs: number;
  endTimeMs: number;
  totalDurationMs: number;
  rootSpanIds: string[];
};

export type DeepTraceSpan = {
  id: string;
  name: string;
  kind: DeepTraceSpanKind;
  status: DeepTraceSpanStatus;
  parentId: string | null;
  children: string[];
  depth: number;
  startOffsetMs: number;
  durationMs: number;
  endOffsetMs: number;
  ownLogCount: number;
  totalLogCount: number;
  ownErrorCount: number;
  totalErrorCount: number;
  sampleLogId: number | null;
  logIds: number[];
};

export type DeepTraceStore = {
  meta: DeepTraceMeta;
  spans: Record<string, DeepTraceSpan>;
  treeMap: Record<string, string[]>;
  orphanLogs: TelemetryLog[];
  logsById: Record<number, TelemetryLog>;
};

type Aggregate = {
  startMs: number | null;
  endMs: number | null;
  totalLogs: number;
  totalErrors: number;
};

type RawSpan = {
  id: string;
  name: string | null;
  parentId: string | null;
  childIds: string[];
  logIds: number[];
  ownLogs: number;
  ownErrors: number;
  ownStartMs: number | null;
  ownEndMs: number | null;
};

function isErrorLevel(level: string): boolean {
  const upper = level.toUpperCase();
  return upper === "ERROR" || upper === "CRITICAL";
}

function guessKind(spanId: string, spanName: string, sampleLog: TelemetryLog | null): DeepTraceSpanKind {
  if (spanId.startsWith("oc:tool:")) return "TOOL";
  if (spanId.startsWith("oc:message:")) return "CHAIN";
  if (spanId.startsWith("oc:type:")) {
    const type = spanId.slice("oc:type:".length);
    if (type.startsWith("tool.execute") || type.startsWith("command.executed") || type.startsWith("lsp.")) return "TOOL";
    if (type.startsWith("message.")) return "CHAIN";
    return "CHAIN";
  }
  if (spanId.startsWith("oc:")) return "CHAIN";

  const name = spanName.toLowerCase();
  if (/(retriev|search|vector|embed)/.test(name)) return "RETRIEVAL";
  if (/(tool|function|call)/.test(name)) return "TOOL";
  if (/(llm|chat|completion|prompt)/.test(name)) return "LLM";

  const attrs = sampleLog?.attributes;
  if (attrs && typeof attrs === "object") {
    const otel = (attrs as Record<string, unknown>)["otel"];
    const spanName = typeof (otel as Record<string, unknown> | undefined)?.["span_name"] === "string"
      ? String((otel as Record<string, unknown>)["span_name"]).toLowerCase()
      : "";
    if (/(retriev|search|vector|embed)/.test(spanName)) return "RETRIEVAL";
    if (/(tool|function|call)/.test(spanName)) return "TOOL";
    if (/(llm|chat|completion|prompt)/.test(spanName)) return "LLM";
  }

  return "CHAIN";
}

function minMs(values: Array<number | null>): number | null {
  let out: number | null = null;
  for (const v of values) {
    if (v == null) continue;
    out = out == null ? v : Math.min(out, v);
  }
  return out;
}

function maxMs(values: Array<number | null>): number | null {
  let out: number | null = null;
  for (const v of values) {
    if (v == null) continue;
    out = out == null ? v : Math.max(out, v);
  }
  return out;
}

function safeTimeMs(iso: string): number | null {
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function buildDeepTraceStore(logs: TelemetryLog[]): DeepTraceStore {
  const logsById: Record<number, TelemetryLog> = {};
  for (const log of logs) logsById[log.id] = log;

  const traceId =
    logs.find((log) => typeof log.trace_id === "string" && log.trace_id.trim())?.trace_id?.trim() ??
    "unknown";

  const forest = buildSpanForest(logs);

  const raw: Record<string, RawSpan> = {};
  for (const node of forest.byId.values()) {
    const spanId = node.spanId;
    const logIds = node.logs.map((l) => l.id);
    const ownStartMs = logIds.length ? safeTimeMs(node.logs[0].timestamp) : null;
    const ownEndMs = logIds.length ? safeTimeMs(node.logs[node.logs.length - 1].timestamp) : null;
    const ownErrors = node.logs.reduce((acc, l) => acc + (isErrorLevel(l.level) ? 1 : 0), 0);
    raw[spanId] = {
      id: spanId,
      name: node.name,
      parentId: node.parentSpanId,
      childIds: node.children.map((c) => c.spanId),
      logIds,
      ownLogs: logIds.length,
      ownErrors,
      ownStartMs,
      ownEndMs,
    };
  }

  const aggregateMemo = new Map<string, Aggregate>();
  const computeAggregate = (spanId: string): Aggregate => {
    const cached = aggregateMemo.get(spanId);
    if (cached) return cached;

    const node = raw[spanId];
    if (!node) {
      const empty: Aggregate = { startMs: null, endMs: null, totalLogs: 0, totalErrors: 0 };
      aggregateMemo.set(spanId, empty);
      return empty;
    }

    let totalLogs = node.ownLogs;
    let totalErrors = node.ownErrors;
    const childAgg = node.childIds.map((childId) => computeAggregate(childId));
    for (const child of childAgg) {
      totalLogs += child.totalLogs;
      totalErrors += child.totalErrors;
    }

    const startMs = minMs([node.ownStartMs, ...childAgg.map((c) => c.startMs)]);
    const endMs = maxMs([node.ownEndMs, ...childAgg.map((c) => c.endMs)]);

    const result: Aggregate = { startMs, endMs, totalLogs, totalErrors };
    aggregateMemo.set(spanId, result);
    return result;
  };

  const rootSpanIds = forest.roots.map((n) => n.spanId);
  const rootAgg = rootSpanIds.map((id) => computeAggregate(id));

  const traceStartMs = minMs(rootAgg.map((a) => a.startMs)) ?? Date.now();
  const traceEndMs = maxMs(rootAgg.map((a) => a.endMs)) ?? traceStartMs;
  const totalDurationMs = Math.max(0, traceEndMs - traceStartMs);

  const spans: Record<string, DeepTraceSpan> = {};
  for (const spanId of Object.keys(raw)) {
    const node = raw[spanId];
    const agg = computeAggregate(spanId);
    const name = node.name?.trim() ? node.name.trim() : shortId(spanId, 18);

    const startOffsetMs = agg.startMs == null ? 0 : Math.max(0, agg.startMs - traceStartMs);
    const endOffsetMs = agg.endMs == null ? startOffsetMs : Math.max(startOffsetMs, agg.endMs - traceStartMs);
    const durationMs = Math.max(0, endOffsetMs - startOffsetMs);

    const sampleLogId = node.logIds.length ? node.logIds[0] : null;
    const sampleLog = sampleLogId != null ? logsById[sampleLogId] ?? null : null;

    spans[spanId] = {
      id: spanId,
      name,
      kind: guessKind(spanId, name, sampleLog),
      status: agg.totalErrors > 0 ? "error" : "success",
      parentId: node.parentId,
      children: node.childIds.slice(),
      depth: 0,
      startOffsetMs,
      durationMs,
      endOffsetMs,
      ownLogCount: node.ownLogs,
      totalLogCount: agg.totalLogs,
      ownErrorCount: node.ownErrors,
      totalErrorCount: agg.totalErrors,
      sampleLogId,
      logIds: node.logIds.slice(),
    };
  }

  const treeMap: Record<string, string[]> = {};
  for (const span of Object.values(spans)) {
    const parentKey = span.parentId ?? "__root__";
    treeMap[parentKey] = treeMap[parentKey] ? [...treeMap[parentKey], span.id] : [span.id];
  }

  const sortChildren = (ids: string[]) =>
    ids
      .slice()
      .sort((a, b) => spans[a].startOffsetMs - spans[b].startOffsetMs || spans[a].name.localeCompare(spans[b].name));

  for (const [parentId, childIds] of Object.entries(treeMap)) {
    treeMap[parentId] = sortChildren(childIds);
  }

  const assignDepth = (spanId: string, depth: number) => {
    spans[spanId].depth = depth;
    spans[spanId].children = sortChildren(spans[spanId].children);
    for (const childId of spans[spanId].children) assignDepth(childId, depth + 1);
  };

  for (const rootId of sortChildren(rootSpanIds)) assignDepth(rootId, 0);

  return {
    meta: {
      traceId,
      startTimeMs: traceStartMs,
      endTimeMs: traceEndMs,
      totalDurationMs,
      rootSpanIds: sortChildren(rootSpanIds),
    },
    spans,
    treeMap,
    orphanLogs: forest.orphanLogs,
    logsById,
  };
}

export function buildVisibleSpanIds(store: DeepTraceStore, collapsed: Set<string>): string[] {
  const out: string[] = [];
  const walk = (spanId: string) => {
    out.push(spanId);
    if (collapsed.has(spanId)) return;
    for (const childId of store.spans[spanId].children) walk(childId);
  };
  for (const rootId of store.meta.rootSpanIds) walk(rootId);
  return out;
}

export function computeCriticalPath(store: DeepTraceStore): Set<string> {
  if (store.meta.rootSpanIds.length === 0) return new Set();
  const epsilon = 1;

  let bestRoot = store.meta.rootSpanIds[0];
  for (const rootId of store.meta.rootSpanIds) {
    if (store.spans[rootId].endOffsetMs > store.spans[bestRoot].endOffsetMs) bestRoot = rootId;
  }

  const path = new Set<string>();
  let current = bestRoot;
  while (true) {
    path.add(current);
    const node = store.spans[current];
    if (!node.children.length) break;

    let next: string | null = null;
    for (const childId of node.children) {
      const child = store.spans[childId];
      if (Math.abs(child.endOffsetMs - node.endOffsetMs) <= epsilon) {
        next = childId;
        break;
      }
    }

    if (!next) {
      next = node.children.reduce(
        (best, id) => (store.spans[id].endOffsetMs > store.spans[best].endOffsetMs ? id : best),
        node.children[0],
      );
    }

    if (!next || next === current) break;
    current = next;
  }

  return path;
}

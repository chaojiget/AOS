export type TelemetryLog = {
  id: number;
  timestamp: string;
  trace_id: string | null;
  span_id: string | null;
  parent_span_id: string | null;
  span_name: string | null;
  level: string;
  logger_name: string | null;
  message: string;
  attributes: unknown;
};

export type TraceSummary = {
  trace_id: string;
  entries: number;
  errors: number;
  last_time: string | null;
  last_logger_name: string | null;
  last_message: string | null;
  span_id: string | null;
  span_name: string | null;
};

export type SpanNode = {
  spanId: string;
  parentSpanId: string | null;
  name: string | null;
  logs: TelemetryLog[];
  children: SpanNode[];
};

type SpanMeta = {
  parentSpanId: string | null;
  name: string | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function otelFromAttributes(attributes: unknown): Record<string, unknown> | null {
  const candidate = asObject(attributes)?.["otel"];
  return asObject(candidate);
}

function extractSpanName(logs: TelemetryLog[]): string | null {
  for (const log of logs) {
    const otel = otelFromAttributes(log.attributes);
    const spanName = otel?.["span_name"];
    if (typeof spanName === "string" && spanName.trim()) return spanName;
  }
  return null;
}

function extractParentSpanId(logs: TelemetryLog[]): string | null {
  for (const log of logs) {
    const otel = otelFromAttributes(log.attributes);
    const parentSpanId = otel?.["parent_span_id"];
    if (typeof parentSpanId === "string" && parentSpanId.trim()) return parentSpanId;
  }
  return null;
}

function isOpenCodeLog(log: TelemetryLog): boolean {
  if (log.logger_name === "opencode") return true;
  const attrs = asObject(log.attributes);
  const tags = attrs?.["tags"];
  if (!Array.isArray(tags)) return false;
  return tags.some((tag) => tag === "opencode");
}

function openCodeRootMeta(log: TelemetryLog): { rootSpanId: string; rootName: string } {
  const traceId =
    typeof log.trace_id === "string" && log.trace_id.trim() ? log.trace_id.trim() : "unknown";
  const rootSpanId = `oc:trace:${traceId}`;

  const attrs = asObject(log.attributes);
  const project = asObject(attrs?.["project"]);
  const projectIdCandidate = project?.["id"];
  const projectId =
    typeof projectIdCandidate === "string" && projectIdCandidate.trim()
      ? projectIdCandidate.trim()
      : "";

  const directoryCandidate = attrs?.["directory"];
  const directory =
    typeof directoryCandidate === "string" && directoryCandidate.trim()
      ? directoryCandidate.trim()
      : "";

  const rootName = projectId ? `OpenCode (${projectId})` : directory ? `OpenCode (${directory})` : "OpenCode";
  return { rootSpanId, rootName };
}

function mergeSpanMeta(meta: Map<string, SpanMeta>, spanId: string, next: SpanMeta) {
  const existing = meta.get(spanId);
  if (!existing) {
    meta.set(spanId, next);
    return;
  }
  meta.set(spanId, {
    parentSpanId: existing.parentSpanId ?? next.parentSpanId,
    name: existing.name ?? next.name,
  });
}

function deriveSpanMeta(log: TelemetryLog): { spanId: string; meta: SpanMeta; ensure?: Array<[string, SpanMeta]> } | null {
  const otel = otelFromAttributes(log.attributes);
  const otelSpanId = otel?.["span_id"];
  if (typeof otelSpanId === "string" && otelSpanId.trim()) {
    const parentSpanIdRaw = otel?.["parent_span_id"];
    const nameRaw = otel?.["span_name"];
    return {
      spanId: otelSpanId.trim(),
      meta: {
        parentSpanId: typeof parentSpanIdRaw === "string" && parentSpanIdRaw.trim() ? parentSpanIdRaw.trim() : null,
        name: typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : null,
      },
    };
  }

  if (!isOpenCodeLog(log)) return null;

  const { rootSpanId, rootName } = openCodeRootMeta(log);
  const attrs = asObject(log.attributes);
  const type = typeof attrs?.["type"] === "string" ? attrs.type.trim() : "";

  const ensure: Array<[string, SpanMeta]> = [[rootSpanId, { parentSpanId: null, name: rootName }]];

  const props = asObject(attrs?.["properties"]);
  const part = asObject(props?.["part"]);
  const info = asObject(props?.["info"]);

  const messageIdCandidate =
    (typeof part?.["messageID"] === "string" ? part["messageID"] : null) ??
    (typeof part?.["messageId"] === "string" ? part["messageId"] : null) ??
    (typeof info?.["id"] === "string" ? info["id"] : null) ??
    (typeof props?.["messageID"] === "string" ? props["messageID"] : null) ??
    (typeof props?.["messageId"] === "string" ? props["messageId"] : null);

  const messageId =
    typeof messageIdCandidate === "string" && messageIdCandidate.trim()
      ? messageIdCandidate.trim()
      : null;

  const toolCandidate = typeof props?.["tool"] === "string" ? props.tool : null;
  const tool = typeof toolCandidate === "string" && toolCandidate.trim() ? toolCandidate.trim() : null;

  if (type.startsWith("session.")) {
    return { spanId: rootSpanId, meta: { parentSpanId: null, name: rootName }, ensure };
  }

  if (messageId) {
    return {
      spanId: `oc:message:${messageId}`,
      meta: { parentSpanId: rootSpanId, name: `message ${shortId(messageId, 16)}` },
      ensure,
    };
  }

  if (tool) {
    return {
      spanId: `oc:tool:${tool}`,
      meta: { parentSpanId: rootSpanId, name: `tool ${tool}` },
      ensure,
    };
  }

  if (type) {
    return {
      spanId: `oc:type:${type}`,
      meta: { parentSpanId: rootSpanId, name: type },
      ensure,
    };
  }

  return { spanId: rootSpanId, meta: { parentSpanId: null, name: rootName }, ensure };
}

function minTimestampMs(logs: TelemetryLog[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const log of logs) {
    const ms = new Date(log.timestamp).getTime();
    if (!Number.isNaN(ms)) min = Math.min(min, ms);
  }
  return min;
}

export function buildSpanForest(logs: TelemetryLog[]): {
  roots: SpanNode[];
  byId: Map<string, SpanNode>;
  orphanLogs: TelemetryLog[];
} {
  const bySpanId = new Map<string, TelemetryLog[]>();
  const metaBySpanId = new Map<string, SpanMeta>();
  const orphanLogs: TelemetryLog[] = [];

  for (const log of logs) {
    let spanId = log.span_id;

    if (!spanId) {
      const derived = deriveSpanMeta(log);
      if (!derived) {
        orphanLogs.push(log);
        continue;
      }

      spanId = derived.spanId;
      mergeSpanMeta(metaBySpanId, derived.spanId, derived.meta);
      for (const [ensureId, ensureMeta] of derived.ensure ?? []) {
        mergeSpanMeta(metaBySpanId, ensureId, ensureMeta);
      }
    }

    const existing = bySpanId.get(spanId) ?? [];
    existing.push(log);
    bySpanId.set(spanId, existing);
  }

  const byId = new Map<string, SpanNode>();
  for (const [spanId, spanLogs] of bySpanId.entries()) {
    const derivedMeta = metaBySpanId.get(spanId);
    const node: SpanNode = {
      spanId,
      parentSpanId: extractParentSpanId(spanLogs) ?? derivedMeta?.parentSpanId ?? null,
      name: extractSpanName(spanLogs) ?? derivedMeta?.name ?? null,
      logs: spanLogs.slice().sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
      children: [],
    };
    byId.set(spanId, node);
  }

  let added = true;
  while (added) {
    added = false;
    for (const node of byId.values()) {
      const parentId = node.parentSpanId;
      if (!parentId || byId.has(parentId) || !metaBySpanId.has(parentId)) continue;
      const parentMeta = metaBySpanId.get(parentId)!;
      byId.set(parentId, {
        spanId: parentId,
        parentSpanId: parentMeta.parentSpanId,
        name: parentMeta.name,
        logs: [],
        children: [],
      });
      added = true;
    }
  }

  const roots: SpanNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.parentSpanId;
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortTree = (n: SpanNode) => {
    n.children.sort((a, b) => minTimestampMs(a.logs) - minTimestampMs(b.logs));
    for (const c of n.children) sortTree(c);
  };
  roots.sort((a, b) => minTimestampMs(a.logs) - minTimestampMs(b.logs));
  for (const root of roots) sortTree(root);

  return { roots, byId, orphanLogs };
}

export function shortId(value: string, keep: number): string {
  if (value.length <= keep) return value;
  const head = Math.max(6, Math.floor(keep / 2));
  const tail = Math.max(4, keep - head - 1);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

export function getLevelVariant(level: string): "default" | "error" | "warn" | "info" {
  const upper = level.toUpperCase();
  if (upper === "ERROR" || upper === "CRITICAL") return "error";
  if (upper === "WARN" || upper === "WARNING") return "warn";
  if (upper === "INFO") return "info";
  return "default";
}

export function humanTime(iso: string, lang: "zh" | "en"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

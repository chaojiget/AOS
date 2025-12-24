const DEFAULT_BACKEND_URL = "http://localhost:8080";
const LOGS_ENDPOINT_PATH = "/api/v1/telemetry/logs";
const DEFAULT_FLUSH_MS = 750;
const MAX_QUEUE_SIZE = 200;
const BACKOFF_MS = 5000;
const MESSAGE_PART_DEBOUNCE_MS = 1500;
const MAX_STRING_LENGTH = 800;

const SENSITIVE_KEY_RE = /(api[_-]?key|token|password|secret|authorization)/i;

function parseBool(value, defaultValue) {
  if (value == null || value === "") return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return defaultValue;
}

function parseIntEnv(value, defaultValue) {
  if (value == null || value === "") return defaultValue;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return parsed;
}

function generateId() {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return uuid;
  } catch {
    // ignore
  }
  const t = Date.now().toString(16);
  const r = Math.random().toString(16).slice(2);
  return `${t}${r}`;
}

function sanitizeJson(value, seen = new WeakSet()) {
  if (value == null) return value;

  const t = typeof value;
  if (t === "string") {
    if (value.length <= MAX_STRING_LENGTH) return value;
    return `${value.slice(0, MAX_STRING_LENGTH)}…`;
  }

  if (t === "number" || t === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJson(item, seen));
  }

  if (t !== "object") return String(value);

  if (seen.has(value)) return "<circular>";
  seen.add(value);

  const output = {};
  for (const [key, raw] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      output[key] = "<redacted>";
      continue;
    }
    output[key] = sanitizeJson(raw, seen);
  }
  return output;
}

function shouldCapture(type) {
  if (!type) return false;

  return new Set([
    "session.created",
    "session.idle",
    "session.error",
    "message.updated",
    "message.part.updated",
    "tool.execute.before",
    "tool.execute.after",
    "file.edited",
    "file.watcher.updated",
    "command.executed",
    "tui.command.execute",
  ]).has(type);
}

const DEBOUNCED_TYPES = new Set(["message.part.updated", "tui.prompt.append"]);

function getSessionId(event) {
  return (
    event?.sessionID ??
    event?.sessionId ??
    event?.session_id ??
    event?.session?.id ??
    event?.session?.sessionID ??
    event?.session?.sessionId ??
    event?.session?.session_id ??
    null
  );
}

function normalizeBaseUrl(url) {
  if (!url) return DEFAULT_BACKEND_URL;
  return String(url).trim().replace(/\/+$/, "");
}

function buildTags({ projectId, sessionId, toolName, role }) {
  const tags = ["opencode"];
  if (projectId) tags.push(`project:${projectId}`);
  if (sessionId) tags.push(`session:${sessionId}`);
  if (toolName) tags.push(`tool:${toolName}`);
  if (role) tags.push(`role:${role}`);
  return tags;
}

function buildLogEntry({ event, projectId, directory, worktree, localTraceId }) {
  const sessionId = getSessionId(event);
  const traceId = sessionId ?? localTraceId;

  return {
    timestamp: new Date().toISOString(),
    trace_id: traceId,
    span_id: generateId(),
    parent_span_id: null,
    event_type: event?.type ?? "unknown",
    tags: buildTags({
      projectId,
      sessionId,
      toolName: event?.tool,
      role: event?.role,
    }),
    dimensions: {
      project_id: projectId ?? null,
      session_id: sessionId,
      directory,
      worktree,
    },
    attributes: sanitizeJson(event),
  };
}

export const AosConnector = async ({ project, directory, worktree }) => {
  const enabled = parseBool(process.env.AOS_OPENCODE_TELEMETRY, true);
  if (!enabled) return {};

  const backendUrl = normalizeBaseUrl(process.env.AOS_BACKEND_URL);
  const flushMs = Math.max(200, parseIntEnv(process.env.AOS_OPENCODE_FLUSH_MS, DEFAULT_FLUSH_MS));
  const endpointUrl = `${backendUrl}${LOGS_ENDPOINT_PATH}`;

  const projectId = project?.id ?? null;
  const localTraceId = generateId();
  const queue = [];
  const debouncers = new Map();

  let flushing = false;
  let backoffUntil = 0;

  function enqueue(entry) {
    queue.push(entry);
    while (queue.length > MAX_QUEUE_SIZE) queue.shift();
  }

  async function flush() {
    if (flushing) return;
    if (queue.length === 0) return;
    if (Date.now() < backoffUntil) return;

    flushing = true;
    const batch = queue.splice(0, queue.length);
    try {
      const res = await fetch(endpointUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(batch),
      });
      if (!res.ok) throw new Error(`AOS connector HTTP ${res.status}`);
    } catch {
      queue.unshift(...batch);
      backoffUntil = Date.now() + BACKOFF_MS;
    } finally {
      flushing = false;
    }
  }

  const interval = setInterval(() => {
    flush().catch(() => undefined);
  }, flushMs);
  interval.unref?.();

  function debounce(key, fn, ms) {
    const existing = debouncers.get(key);
    if (existing?.timeoutId) clearTimeout(existing.timeoutId);

    const timeoutId = setTimeout(() => {
      debouncers.delete(key);
      fn();
    }, ms);

    debouncers.set(key, { timeoutId });
  }

  return {
    event: async ({ event }) => {
      if (!shouldCapture(event?.type)) return;

      const entry = buildLogEntry({
        event,
        projectId,
        directory,
        worktree,
        localTraceId,
      });

      if (DEBOUNCED_TYPES.has(event.type)) {
        const sessionId = getSessionId(event) ?? "local";
        debounce(`${sessionId}:${event.type}`, () => {
          enqueue(entry);
        }, MESSAGE_PART_DEBOUNCE_MS);
        return;
      }

      enqueue(entry);

      if (event.type === "session.idle" || queue.length >= MAX_QUEUE_SIZE) {
        await flush();
      }
    },
  };
};

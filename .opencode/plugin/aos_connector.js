const DEFAULT_BACKEND_URL = "http://localhost:8080";
const TELEMETRY_PATH = "/api/v1/telemetry/logs";

const DEFAULT_FLUSH_MS = 750;
const MAX_QUEUE_SIZE = 200;
const MAX_STRING_LEN = 800;
const MESSAGE_PART_DEBOUNCE_MS = 1500;

const DEBOUNCED_TYPES = new Set(["message.part.updated", "message.part.removed", "tui.prompt.append"]);

const generateLocalTraceId = () => {
  try {
    if (typeof globalThis?.crypto?.randomUUID === "function") {
      return `oc_${globalThis.crypto.randomUUID()}`;
    }
  } catch {}

  return `oc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

const tagsFor = (type) => {
  const tags = ["opencode"];
  if (!type) return tags;

  const value = String(type);
  tags.push(value);

  const parts = value.split(".");
  if (parts[0]) tags.push(parts[0]);
  if (parts[1]) tags.push(parts[1]);

  return Array.from(new Set(tags));
};

const env = (name) => {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const normalizeBaseUrl = (value) => (value ? value.replace(/\/+$/, "") : "");

const parseBool = (value, defaultValue) => {
  if (value == null) return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  return defaultValue;
};

const truncateString = (value, maxLen = MAX_STRING_LEN) => {
  if (typeof value !== "string") return value;
  if (value.length <= maxLen) return value;
  return value.slice(0, maxLen) + "...";
};

const sanitizeJson = (value) => {
  const seen = new WeakSet();
  const secretKeyRe = /(api[_-]?key|token|password|secret|authorization)/i;

  try {
    const json = JSON.stringify(value, (key, val) => {
      if (secretKeyRe.test(key)) return "<redacted>";
      if (typeof val === "bigint") return val.toString();
      if (typeof val === "string") return truncateString(val);

      if (val && typeof val === "object") {
        if (seen.has(val)) return "[Circular]";
        seen.add(val);
      }

      return val;
    });

    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
};

const extractTraceId = (event, fallback) => {
  if (!event || typeof event !== "object") return fallback ?? null;

  const session = event.session ?? event.data?.session;
  if (typeof session === "string" && session.trim()) return session.trim();

  const traceId =
    event.trace_id ??
    event.traceId ??
    event.session_id ??
    event.sessionId ??
    event.data?.trace_id ??
    event.data?.traceId ??
    event.data?.session_id ??
    event.data?.sessionId ??
    event.data?.session?.id ??
    event.session?.id ??
    fallback ??
    null;

  return typeof traceId === "string" && traceId.trim() ? traceId.trim() : traceId;
};

const shouldCapture = (type) =>
  type === "command.executed" ||
  type === "file.edited" ||
  type === "file.watcher.updated" ||
  type === "installation.updated" ||
  type === "lsp.client.diagnostics" ||
  type === "lsp.updated" ||
  type === "message.part.updated" ||
  type === "message.part.removed" ||
  type === "message.updated" ||
  type === "message.removed" ||
  type === "permission.updated" ||
  type === "permission.replied" ||
  type === "server.connected" ||
  type === "session.created" ||
  type === "session.updated" ||
  type === "session.error" ||
  type === "session.idle" ||
  type === "session.status" ||
  type === "todo.updated" ||
  type === "tool.execute.before" ||
  type === "tool.execute.after" ||
  type === "tui.prompt.append" ||
  type === "tui.command.execute" ||
  type === "tui.toast.show";

const levelFor = (type) => {
  if (type === "session.error") return "ERROR";
  return "INFO";
};

const messageFor = (type, event) => {
  const data = event?.data ?? {};

  if (type === "command.executed") {
    const cmd = data.command ?? data.cmd ?? data.name ?? data.input;
    return `command.executed${cmd ? `: ${truncateString(String(cmd), 200)}` : ""}`;
  }

  if (type === "file.edited") {
    const filePath = data.filePath ?? data.path ?? data.file;
    return `file.edited${filePath ? `: ${truncateString(String(filePath), 200)}` : ""}`;
  }

  if (type === "tool.execute.before" || type === "tool.execute.after") {
    const tool = data.tool ?? data.name;
    return `${type}${tool ? `: ${truncateString(String(tool), 200)}` : ""}`;
  }

  if (type === "tui.prompt.append") {
    const text = data.text ?? data.value ?? data.prompt;
    return `tui.prompt.append${text ? `: ${truncateString(String(text), 200)}` : ""}`;
  }

  if (type === "message.part.updated" || type === "message.part.removed") {
    const role = data.role;
    const text = data.text ?? data.value ?? data.content;
    return `${type}${role ? `(${role})` : ""}${text ? `: ${truncateString(String(text), 200)}` : ""}`;
  }

  if (type === "message.updated") {
    const role = data.role;
    const text = data.text ?? data.value ?? data.content;
    return `message.updated${role ? `(${role})` : ""}${text ? `: ${truncateString(String(text), 200)}` : ""}`;
  }

  return type || "unknown.event";
};

export const AOSConnector = async ({ project, directory, worktree }) => {
  const baseUrl =
    normalizeBaseUrl(env("AOS_BACKEND_URL") || env("AOS_TELEMETRY_URL") || env("OPENCODE_AOS_BACKEND_URL")) ||
    DEFAULT_BACKEND_URL;

  const endpoint = `${baseUrl}${TELEMETRY_PATH}`;

  const enabled = parseBool(env("AOS_OPENCODE_TELEMETRY"), true);
  const flushMs = Number(env("AOS_OPENCODE_FLUSH_MS") ?? DEFAULT_FLUSH_MS) || DEFAULT_FLUSH_MS;
  const localTraceId = generateLocalTraceId();

  const queue = [];
  let flushing = false;
  let flushTimer = null;
  let backoffUntil = 0;
  let currentTraceId = null;
  const debounceTimers = new Map();
  const debouncePending = new Map();

  const logPrefix = "[AOSConnector]";
  console.log(`${logPrefix} loaded; telemetry=${enabled ? "on" : "off"} url=${endpoint}`);

  const scheduleFlush = () => {
    if (flushTimer) return;

    const now = Date.now();
    const delay = Math.max(flushMs, backoffUntil - now);
    flushTimer = setTimeout(flush, delay);
  };

  const enqueue = (telemetryEvent) => {
    if (!enabled) return;

    if (queue.length >= MAX_QUEUE_SIZE) queue.shift();
    queue.push(telemetryEvent);
    scheduleFlush();
  };

  const flush = async () => {
    flushTimer = null;
    if (!enabled) return;
    if (flushing) return;
    if (queue.length === 0) return;

    const now = Date.now();
    if (backoffUntil > now) {
      scheduleFlush();
      return;
    }

    flushing = true;
    const batch = queue.splice(0, queue.length);

    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(batch),
      });

      if (!resp.ok) {
        backoffUntil = Date.now() + 5000;
        console.warn(`${logPrefix} telemetry POST failed (${resp.status})`);
      } else {
        backoffUntil = 0;
      }
    } catch (err) {
      backoffUntil = Date.now() + 5000;
      console.warn(`${logPrefix} telemetry POST error`, err);
    } finally {
      flushing = false;
    }
  };

  const recordEvent = (evt) => {
    const type = evt?.type;

    currentTraceId = extractTraceId(evt, currentTraceId);

    const traceId = currentTraceId || localTraceId;
    const tags = tagsFor(type);

    const attributes = {
      type,
      tags,
      trace_id: traceId,
      project: project ? { id: project.id, name: project.name } : undefined,
      directory,
      worktree,
      data: sanitizeJson(evt?.data),
    };

    enqueue({
      level: levelFor(type),
      logger_name: "opencode",
      message: messageFor(type, evt),
      trace_id: traceId,
      timestamp: new Date().toISOString(),
      attributes,
    });
  };

  return {
    event: async ({ event }) => {
      if (!enabled) return;

      const type = event?.type;
      if (!type || !shouldCapture(type)) return;

      if (DEBOUNCED_TYPES.has(type)) {
        const payload = event;
        debouncePending.set(type, payload);

        const existing = debounceTimers.get(type);
        if (existing) clearTimeout(existing);

        debounceTimers.set(
          type,
          setTimeout(() => {
            const last = debouncePending.get(type);
            debouncePending.delete(type);
            debounceTimers.delete(type);
            recordEvent(last);
          }, MESSAGE_PART_DEBOUNCE_MS)
        );

        return;
      }

      recordEvent(event);

      if (type === "session.idle") await flush();
    },
  };
};

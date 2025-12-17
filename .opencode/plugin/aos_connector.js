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

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const randomHex = (bytesLength) => {
  try {
    if (typeof globalThis?.crypto?.getRandomValues === "function") {
      const bytes = new Uint8Array(bytesLength);
      globalThis.crypto.getRandomValues(bytes);
      return toHex(bytes);
    }

    if (typeof globalThis?.crypto?.randomUUID === "function") {
      const uuidHex = globalThis.crypto.randomUUID().replace(/-/g, "");
      return uuidHex.slice(0, bytesLength * 2).padEnd(bytesLength * 2, "0");
    }
  } catch {}

  let out = "";
  for (let i = 0; i < bytesLength * 2; i++) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
};

const generateSpanId = () => randomHex(8);

const sessionStates = new Map();

const getSessionState = (sessionID) => {
  let state = sessionStates.get(sessionID);
  if (state) return state;

  state = {
    sessionID,
    sessionSpanId: generateSpanId(),
    messageSpans: new Map(),
    toolSpans: new Map(),
    callToMessage: new Map(),
    lastAssistantMessageID: null,
    lastSessionStatus: null,
    seenMessageUpdated: new Set(),
    seenToolEvents: new Set(),
  };

  sessionStates.set(sessionID, state);
  return state;
};

const getOrCreateSpan = (spanMap, key) => {
  if (typeof key !== "string" || !key.trim()) return null;

  const normalized = key.trim();
  let spanId = spanMap.get(normalized);
  if (!spanId) {
    spanId = generateSpanId();
    spanMap.set(normalized, spanId);
  }

  return spanId;
};

const tagsFor = (type, payload) => {
  const tags = ["opencode"];

  if (type) {
    const value = String(type);
    tags.push(value);

    const parts = value.split(".");
    if (parts[0]) tags.push(parts[0]);
    if (parts[1]) tags.push(parts[1]);
  }

  // Common dimensions
  const sessionID = payload?.sessionID ?? payload?.info?.sessionID ?? payload?.part?.sessionID;
  if (typeof sessionID === "string" && sessionID.trim()) tags.push(`session:${sessionID.trim()}`);

  const projectID = payload?.info?.projectID;
  if (typeof projectID === "string" && projectID.trim()) tags.push(`project:${projectID.trim()}`);

  const messageID = payload?.info?.id ?? payload?.messageID ?? payload?.part?.messageID;
  if (typeof messageID === "string" && messageID.trim()) tags.push(`message:${messageID.trim()}`);

  const role = payload?.info?.role;
  if (typeof role === "string" && role.trim()) tags.push(`role:${role.trim()}`);

  const toolName = payload?.tool ?? payload?.part?.tool;
  if (typeof toolName === "string" && toolName.trim()) tags.push(`tool:${toolName.trim()}`);

  const callID = payload?.callID ?? payload?.part?.callID;
  if (typeof callID === "string" && callID.trim()) tags.push(`call:${callID.trim()}`);

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

  const type = event.type;
  const properties = event.properties ?? event.data ?? {};

  let sessionID = null;

  if (type === "session.created" || type === "session.updated" || type === "session.deleted") {
    sessionID = properties.info?.id;
  } else if (type === "message.updated") {
    sessionID = properties.info?.sessionID;
  } else if (type === "message.part.updated") {
    sessionID = properties.part?.sessionID;
  } else if (type === "message.part.removed" || type === "message.removed") {
    sessionID = properties.sessionID;
  } else if (type === "session.error" || type === "session.idle" || type === "session.status" || type === "session.compacted" || type === "session.diff") {
    sessionID = properties.sessionID;
  } else if (
    type === "command.executed" ||
    type === "todo.updated" ||
    type === "permission.updated" ||
    type === "permission.replied" ||
    type === "tool.execute.before" ||
    type === "tool.execute.after" ||
    type === "chat.message"
  ) {
    sessionID = properties.sessionID;
  } else {
    sessionID = properties.sessionID ?? properties.sessionId ?? null;
  }

  if (typeof sessionID === "string" && sessionID.trim()) return sessionID.trim();

  // Backwards-compat / ad-hoc shapes
  const session = event.session ?? properties.session;
  if (typeof session === "string" && session.trim()) return session.trim();

  const traceId =
    event.trace_id ??
    event.traceId ??
    event.session_id ??
    event.sessionId ??
    properties.trace_id ??
    properties.traceId ??
    properties.session_id ??
    properties.sessionId ??
    properties.session?.id ??
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

const levelFor = (type, payload) => {
  if (type === "session.error" || type === "tui.toast.show") return "ERROR";

  if (type === "session.status") {
    const statusType = payload?.status?.type;
    if (statusType === "retry") return "WARNING";
  }

  if (type === "tool.execute.after") {
    const status = payload?.state?.status;
    if (status === "error") return "ERROR";
  }

  if (type === "permission.updated" || type === "permission.replied") return "WARNING";

  return "INFO";
};

const messageFor = (type, event) => {
  const data = event?.properties ?? event?.data ?? {};

  if (type === "command.executed") {
    const name = data.name;
    const args = data.arguments;
    return `command.executed${name ? `: ${name}` : ""}${args ? ` ${truncateString(String(args), 120)}` : ""}`;
  }

  if (type === "file.edited") {
    const filePath = data.file;
    return `file.edited${filePath ? `: ${truncateString(String(filePath), 200)}` : ""}`;
  }

  if (type === "file.watcher.updated") {
    const filePath = data.file;
    const fileEvent = data.event;
    return `file.watcher.updated${fileEvent ? `(${fileEvent})` : ""}${filePath ? `: ${truncateString(String(filePath), 200)}` : ""}`;
  }

  if (type === "tool.execute.before" || type === "tool.execute.after") {
    const tool = data.tool;
    return `${type}${tool ? `: ${truncateString(String(tool), 200)}` : ""}`;
  }

  if (type === "tui.prompt.append") {
    const text = data.text;
    return `tui.prompt.append${text ? `: ${truncateString(String(text), 200)}` : ""}`;
  }

  if (type === "tui.command.execute") {
    const command = data.command;
    return `tui.command.execute${command ? `: ${truncateString(String(command), 200)}` : ""}`;
  }

  if (type === "tui.toast.show") {
    const variant = data.variant;
    const toastMessage = data.message;
    return `tui.toast.show${variant ? `(${variant})` : ""}${toastMessage ? `: ${truncateString(String(toastMessage), 200)}` : ""}`;
  }

  if (type === "message.part.updated" || type === "message.part.removed") {
    const part = data.part;
    const sessionID = part?.sessionID;
    const messageID = part?.messageID;

    const delta = data.delta;
    const partType = part?.type;

    let text = partType === "text" ? part.text : undefined;
    if (!text && typeof delta === "string") text = delta;

    const toolName = partType === "tool" ? part.tool : undefined;
    const status = partType === "tool" ? part.state?.status : undefined;

    return `${type}${sessionID ? ` [${sessionID}]` : ""}${messageID ? ` ${messageID}` : ""}${partType ? ` <${partType}>` : ""}${toolName ? ` ${toolName}` : ""}${status ? `(${status})` : ""}${text ? `: ${truncateString(String(text), 200)}` : ""}`;
  }

  if (type === "message.updated") {
    const info = data.info;
    const sessionID = info?.sessionID;
    const role = info?.role;
    const messageID = info?.id;
    return `message.updated${sessionID ? ` [${sessionID}]` : ""}${role ? `(${role})` : ""}${messageID ? ` ${messageID}` : ""}`;
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

    const properties = evt?.properties ?? evt?.data;
    const payload = sanitizeJson(properties);
    if (payload == null) return;

    const sessionID = currentTraceId;

    let spanId = null;
    let parentSpanId = null;

    if (typeof sessionID === "string" && sessionID.trim()) {
      const state = getSessionState(sessionID);

      // De-dupe noisy session.status events.
      if (type === "session.status") {
        const statusType = payload?.status?.type;
        const fingerprint = statusType ? String(statusType) : "unknown";
        if (state.lastSessionStatus === fingerprint) return;
        state.lastSessionStatus = fingerprint;
      }

      // De-dupe repeated message.updated for the same message id.
      if (type === "message.updated") {
        const msgId = payload?.info?.id;
        if (typeof msgId === "string" && msgId.trim()) {
          const key = msgId.trim();
          if (state.seenMessageUpdated.has(key)) return;
          state.seenMessageUpdated.add(key);

          if (state.seenMessageUpdated.size > 200) state.seenMessageUpdated.clear();
        }
      }

      // De-dupe tool.execute events by (callID,type)
      if (type === "tool.execute.before" || type === "tool.execute.after") {
        const callID = payload?.callID;
        if (typeof callID === "string" && callID.trim()) {
          const key = `${type}:${callID.trim()}`;
          if (state.seenToolEvents.has(key)) return;
          state.seenToolEvents.add(key);

          if (state.seenToolEvents.size > 500) state.seenToolEvents.clear();
        }
      }

      // Use a stable session span id as the root parent for the whole chain.
      parentSpanId = state.sessionSpanId;
      if (type === "session.created" || type === "session.updated" || type === "session.status" || type === "session.idle") {
        spanId = state.sessionSpanId;
        parentSpanId = null;
      } else if (type === "message.updated") {
        const messageID = payload?.info?.id;
        spanId = getOrCreateSpan(state.messageSpans, messageID);

        if (payload?.info?.role === "assistant" && typeof messageID === "string" && messageID.trim()) {
          state.lastAssistantMessageID = messageID.trim();
        }
      } else if (type === "message.part.updated") {
        const messageID = payload?.part?.messageID;
        spanId = getOrCreateSpan(state.messageSpans, messageID);

        const callID = payload?.part?.callID;
        if (typeof callID === "string" && callID.trim() && typeof messageID === "string" && messageID.trim()) {
          state.callToMessage.set(callID.trim(), messageID.trim());
        }
      } else if (type === "tool.execute.before" || type === "tool.execute.after") {
        const callID = payload?.callID;
        spanId = getOrCreateSpan(state.toolSpans, callID);

        const mappedMessageID = typeof callID === "string" ? state.callToMessage.get(callID) : null;
        const parentMessageID = mappedMessageID || state.lastAssistantMessageID;
        const parentMessageSpan = getOrCreateSpan(state.messageSpans, parentMessageID);
        if (parentMessageSpan) parentSpanId = parentMessageSpan;
      }
    }

    const tags = tagsFor(type, payload);
    const level = levelFor(type, payload);

    // Project/worktree dimensions for aggregation.
    const projectId = project?.id;
    const projectName = project?.name;

    const attributes = {
      type,
      tags,
      trace_id: traceId,
      project: project ? { id: projectId, name: projectName } : undefined,
      directory,
      worktree,
      properties: payload,
      dimensions: {
        project_id: projectId,
        project_name: projectName,
        opencode_project_id: payload?.info?.projectID ?? null,
        worktree,
        directory,
        session_id: typeof sessionID === "string" ? sessionID : null,
        message_id: payload?.info?.id ?? payload?.part?.messageID ?? payload?.messageID ?? null,
        role: payload?.info?.role ?? null,
        tool: payload?.tool ?? payload?.part?.tool ?? null,
        call_id: payload?.callID ?? payload?.part?.callID ?? null,
        tool_status: payload?.state?.status ?? payload?.part?.state?.status ?? null,
      },
      otel: {
        trace_id: traceId,
        span_id: spanId,
        parent_span_id: parentSpanId,
        span_name: type,
      },
    };

    enqueue({
      level,
      logger_name: "opencode",
      message: messageFor(type, evt),
      trace_id: traceId,
      span_id: spanId,
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

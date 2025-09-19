import { FormEventHandler, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NextPage } from "next";

import ChatMessageList, { type ChatHistoryMessage } from "../components/ChatMessageList";
import LogFlowPanel from "../components/LogFlowPanel";
import PlanTimeline, {
  type PlanTimelineEvent,
  type PlanTimelineStep,
} from "../components/PlanTimeline";
import SkillPanel, { type SkillEvent } from "../components/SkillPanel";
import { useI18n } from "../lib/i18n/index";
import {
  badgeClass,
  headerSurfaceClass,
  headingClass,
  insetSurfaceClass,
  inputSurfaceClass,
  labelClass,
  modalBackdropClass,
  modalSurfaceClass,
  outlineButtonClass,
  pageContainerClass,
  panelSurfaceClass,
  pillGroupClass,
  primaryButtonClass,
  shellClass,
  subtleTextClass,
} from "../lib/theme";

type ToolStatus = Extract<SkillEvent, { type: "tool" }>["status"];

interface ChatSendResponse {
  trace_id: string;
  result?: unknown;
  reason?: string;
  events?: Array<{
    ts: string;
    type: string;
    span_id?: string;
    parent_span_id?: string;
    data?: any;
  }>;
  error?: { message?: string } | null;
}

interface StreamEventEnvelope {
  id: string;
  ts: string;
  type: string;
  trace_id?: string;
  span_id?: string;
  parent_span_id?: string;
  data?: any;
}

interface ConfirmationRequestState {
  id: string;
  ts: string;
  message: string;
  context?: any;
  level?: string;
}

type RunStatus = "idle" | "running" | "awaiting-confirmation" | "completed" | "error";

const generateLocalId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
};

const serialiseHistoryForRequest = (messages: ChatHistoryMessage[]) =>
  messages.map((message) => ({
    role: message.role,
    content: message.content,
    msg_id: message.msgId,
    id: message.id,
    ts: message.ts,
  }));

const parseStreamPayload = (raw: string): StreamEventEnvelope | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StreamEventEnvelope;
    if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
      return {
        id: parsed.id ?? generateLocalId(),
        ts: parsed.ts ?? new Date().toISOString(),
        type: parsed.type,
        trace_id: parsed.trace_id,
        span_id: parsed.span_id,
        parent_span_id: parsed.parent_span_id,
        data: parsed.data,
      };
    }
  } catch {
    return null;
  }
  return null;
};

const normaliseEventType = (type?: string): string => {
  if (!type) return "";
  if (type.startsWith("agent.")) {
    return type.slice(6);
  }
  return type;
};

const summarisePlanStep = (step: any): PlanTimelineStep => {
  const title =
    typeof step?.title === "string"
      ? step.title
      : typeof step?.op === "string"
        ? step.op
        : typeof step?.id === "string"
          ? step.id
          : "step";
  const summarySource =
    typeof step?.description === "string"
      ? step.description
      : typeof step?.args?.summary === "string"
        ? step.args.summary
        : typeof step?.args?.prompt === "string"
          ? step.args.prompt
          : undefined;
  const summary = summarySource
    ? summarySource.length > 280
      ? `${summarySource.slice(0, 277)}...`
      : summarySource
    : undefined;
  return {
    id: typeof step?.id === "string" ? step.id : generateLocalId(),
    title,
    summary,
  };
};

const summariseArgs = (args: any): string | undefined => {
  if (!args) return undefined;
  if (typeof args === "string") {
    return args.length > 160 ? `${args.slice(0, 157)}...` : args;
  }
  if (typeof args === "object") {
    if (typeof args.prompt === "string") {
      const prompt = args.prompt.trim();
      return prompt.length > 160 ? `${prompt.slice(0, 157)}...` : prompt;
    }
    if (typeof args.query === "string") {
      const query = args.query.trim();
      return query.length > 160 ? `${query.slice(0, 157)}...` : query;
    }
    try {
      const json = JSON.stringify(args);
      return json.length > 160 ? `${json.slice(0, 157)}...` : json;
    } catch {
      return undefined;
    }
  }
  return undefined;
};

const summariseResult = (result: any): string | undefined => {
  if (result == null) return undefined;
  if (typeof result === "string") {
    const trimmed = result.trim();
    return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
  }
  if (typeof result === "object") {
    if (typeof result.text === "string") {
      const text = result.text.trim();
      return text.length > 160 ? `${text.slice(0, 157)}...` : text;
    }
    if (typeof result.content === "string") {
      const text = result.content.trim();
      return text.length > 160 ? `${text.slice(0, 157)}...` : text;
    }
    if (typeof result.message === "string") {
      const text = result.message.trim();
      return text.length > 160 ? `${text.slice(0, 157)}...` : text;
    }
    try {
      const json = JSON.stringify(result);
      return json.length > 160 ? `${json.slice(0, 157)}...` : json;
    } catch {
      return undefined;
    }
  }
  return undefined;
};

const extractNumeric = (value: any): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
};

const extractTokens = (payload: any): number | null => {
  if (!payload || typeof payload !== "object") return null;
  const direct = extractNumeric((payload as any).tokens);
  if (direct !== null) return direct;
  const nestedTotal = extractNumeric((payload as any).tokens?.total);
  if (nestedTotal !== null) return nestedTotal;
  const usageTotal = extractNumeric((payload as any).usage?.total_tokens);
  if (usageTotal !== null) return usageTotal;
  const usageTotalAlt = extractNumeric((payload as any).usage?.total);
  if (usageTotalAlt !== null) return usageTotalAlt;
  return null;
};

const HomePage: NextPage = () => {
  const { t, locale } = useI18n();
  const [input, setInput] = useState("");
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [traceId, setTraceId] = useState<string | undefined>(undefined);
  const [chatHistory, setChatHistory] = useState<ChatHistoryMessage[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"chat" | "logflow">("chat");
  const [finalOutput, setFinalOutput] = useState<any>(null);
  const [lastEvent, setLastEvent] = useState<StreamEventEnvelope | null>(null);
  const [planEvents, setPlanEvents] = useState<PlanTimelineEvent[]>([]);
  const [planFilter, setPlanFilter] = useState("");
  const [planCollapsed, setPlanCollapsed] = useState(false);
  const [skillEvents, setSkillEvents] = useState<SkillEvent[]>([]);
  const [skillFilter, setSkillFilter] = useState("");
  const [skillCollapsed, setSkillCollapsed] = useState(false);
  const [confirmationRequest, setConfirmationRequest] = useState<ConfirmationRequestState | null>(
    null,
  );
  const [progressPct, setProgressPct] = useState<number | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const currentTraceRef = useRef<string | undefined>(undefined);

  const draftInput = useMemo(() => input.trim(), [input]);

  const resetForRun = useCallback(() => {
    setPlanEvents([]);
    setSkillEvents([]);
    setFinalOutput(null);
    setLastEvent(null);
    setPlanFilter("");
    setSkillFilter("");
    setPlanCollapsed(false);
    setSkillCollapsed(false);
    setConfirmationRequest(null);
    setProgressPct(null);
    setRunError(null);
  }, []);

  const closeStream = useCallback(() => {
    if (retryTimerRef.current != null && typeof window !== "undefined") {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    retryAttemptRef.current = 0;
  }, []);

  useEffect(() => () => closeStream(), [closeStream]);

  const handleStreamEvent = useCallback(
    (event: StreamEventEnvelope) => {
      if (!event || typeof event.type !== "string") {
        return;
      }
      setLastEvent(event);
      if (event.trace_id && event.trace_id !== traceId) {
        setTraceId(event.trace_id);
      }
      const kind = normaliseEventType(event.type);

      if (kind === "chat.msg" || kind === "chat.message") {
        const payload = event.data ?? {};
        const role = typeof payload.role === "string" ? payload.role : "assistant";
        const content =
          typeof payload.text === "string"
            ? payload.text
            : typeof payload.content === "string"
              ? payload.content
              : "";
        const msgId = typeof payload.msg_id === "string" ? payload.msg_id : event.id;
        const timestamp = event.ts ?? new Date().toISOString();
        setChatHistory((history) => {
          const next = [...history];
          if (role === "user") {
            for (let index = next.length - 1; index >= 0; index -= 1) {
              const message = next[index];
              if (message.role === "user" && !message.msgId) {
                next[index] = {
                  ...message,
                  msgId,
                  status: "done",
                  ts: timestamp,
                  content: content || message.content,
                  traceId: event.trace_id ?? message.traceId,
                };
                return next;
              }
            }
          }
          const existingIndex = next.findIndex((item) => item.msgId === msgId);
          if (existingIndex >= 0) {
            next[existingIndex] = {
              ...next[existingIndex],
              content: content || next[existingIndex].content,
              status: "done",
              ts: timestamp,
              traceId: event.trace_id ?? next[existingIndex].traceId,
            };
            return next;
          }
          const message: ChatHistoryMessage = {
            id: msgId ?? generateLocalId(),
            msgId,
            role: role === "system" ? "system" : role === "user" ? "user" : "assistant",
            content,
            ts: timestamp,
            status: "done",
            traceId: event.trace_id,
          };
          return [...next, message];
        });
        return;
      }

      if (kind === "plan" || kind === "plan.updated") {
        const data = event.data ?? {};
        const steps = Array.isArray(data.steps) ? data.steps.map(summarisePlanStep) : [];
        const revisionValue = typeof data.revision === "number" ? data.revision : undefined;
        const reasonText = typeof data.reason === "string" ? data.reason : undefined;
        const planEvent: PlanTimelineEvent = {
          id: event.id,
          ts: event.ts ?? new Date().toISOString(),
          revision: revisionValue,
          reason: reasonText,
          steps,
        };
        setPlanEvents((existing) => {
          const index = existing.findIndex((item) => item.id === planEvent.id);
          if (index >= 0) {
            const next = [...existing];
            next[index] = planEvent;
            return next;
          }
          return [...existing, planEvent].sort((a, b) => {
            const aTime = new Date(a.ts).getTime();
            const bTime = new Date(b.ts).getTime();
            return aTime - bTime;
          });
        });
        return;
      }

      if (kind === "progress") {
        const pct = extractNumeric(event.data?.pct);
        if (pct !== null) {
          setProgressPct(Math.max(0, Math.min(1, pct)));
        }
        return;
      }

      if (kind.startsWith("tool")) {
        const data = event.data ?? {};
        const spanKey = event.span_id ?? event.id;
        const status: ToolStatus =
          kind === "tool.failed" ? "failed" : kind === "tool.started" ? "started" : "succeeded";
        const name =
          typeof data.name === "string"
            ? data.name
            : typeof data.tool === "string"
              ? data.tool
              : "tool";
        const result = data.result ?? data.output ?? data.response;
        const cost = extractNumeric(data.cost ?? result?.cost);
        const latencyMs = extractNumeric(data.latency_ms ?? result?.latency_ms);
        const tokens = extractTokens(result);
        const argsSummary = summariseArgs(data.args);
        const resultSummary = summariseResult(result ?? data.error ?? data.message);
        setSkillEvents((previous) => {
          let updated = false;
          const next = previous.map((item) => {
            if (item.type === "tool" && (item.id === spanKey || item.spanId === spanKey)) {
              updated = true;
              return {
                ...item,
                ts: event.ts ?? item.ts,
                status,
                name,
                spanId: event.span_id ?? item.spanId,
                argsSummary: argsSummary ?? item.argsSummary,
                resultSummary: resultSummary ?? item.resultSummary,
                cost: cost ?? item.cost ?? null,
                latencyMs: latencyMs ?? item.latencyMs ?? null,
                tokens: tokens ?? item.tokens ?? null,
              };
            }
            return item;
          });
          if (!updated) {
            const entry: SkillEvent = {
              type: "tool",
              id: spanKey ?? generateLocalId(),
              ts: event.ts ?? new Date().toISOString(),
              name,
              status,
              spanId: event.span_id,
              argsSummary,
              resultSummary,
              cost: cost ?? null,
              latencyMs: latencyMs ?? null,
              tokens: tokens ?? null,
            };
            next.push(entry);
          }
          return next.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
        });
        return;
      }

      if (kind === "skill.used") {
        const data = event.data ?? {};
        const rawName = typeof data.name === "string" ? data.name.trim() : "";
        const name = rawName || t("panels.skills.unnamedSkill");
        const argsSummary = summariseArgs(data.args);
        const source = typeof data.source === "string" ? data.source.trim() : "";
        const pieces = [t("panels.skills.skillUsed", { name })];
        if (source) {
          pieces.push(source);
        }
        if (argsSummary) {
          pieces.push(argsSummary);
        }
        const level = t("panels.skills.skillLevel");
        setSkillEvents((previous) => {
          if (previous.some((item) => item.id === event.id)) {
            return previous;
          }
          const entry: SkillEvent = {
            type: "note",
            id: event.id,
            ts: event.ts ?? new Date().toISOString(),
            level,
            text: pieces.join(" · "),
          };
          return [...previous, entry].sort(
            (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
          );
        });
        return;
      }

      if (kind === "reflect.note" || kind === "score" || kind === "ask" || kind === "log") {
        const level =
          kind === "reflect.note"
            ? event.data?.level
            : kind === "score"
              ? "score"
              : kind === "ask"
                ? "ask"
                : (event.data?.level ?? "log");
        const text =
          kind === "score"
            ? t("panels.skills.scoreNote", {
                value: event.data?.value ?? "–",
                passed: String(event.data?.passed ?? ""),
              })
            : kind === "ask"
              ? (event.data?.question ?? "")
              : typeof event.data?.text === "string"
                ? event.data.text
                : (event.data?.message ?? "");
        if (typeof text === "string" && text.trim().length > 0) {
          setSkillEvents((previous) => {
            if (previous.some((item) => item.id === event.id)) {
              return previous;
            }
            const entry: SkillEvent = {
              type: "note",
              id: event.id,
              ts: event.ts ?? new Date().toISOString(),
              level: typeof level === "string" ? level : undefined,
              text,
            };
            return [...previous, entry].sort(
              (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
            );
          });
        }
        if (kind === "log" && event.data?.level === "error") {
          setRunStatus("error");
          setRunError(event.data?.message ?? t("chat.runFailure"));
        }
        return;
      }

      if (kind === "user.confirm.request") {
        const prompt =
          typeof event.data?.prompt === "string"
            ? event.data.prompt
            : typeof event.data?.message === "string"
              ? event.data.message
              : t("confirmation.defaultPrompt");
        setConfirmationRequest({
          id: event.id,
          ts: event.ts ?? new Date().toISOString(),
          message: prompt,
          context: event.data,
          level: event.data?.level,
        });
        setRunStatus("awaiting-confirmation");
        setChatHistory((history) => [
          ...history,
          {
            id: generateLocalId(),
            role: "system",
            content: t("confirmation.systemNotice", { message: prompt }),
            ts: event.ts ?? new Date().toISOString(),
            status: "pending",
          },
        ]);
        return;
      }

      if (kind === "final" || kind === "final.answer") {
        const outputs = event.data?.outputs ?? event.data?.result ?? event.data;
        setFinalOutput(outputs);
        setRunStatus("completed");
        setProgressPct(1);
        if (kind === "final") {
          closeStream();
        }
        return;
      }

      if (kind === "run.finished") {
        const outputs =
          event.data?.final ?? event.data?.outputs ?? event.data?.result ?? event.data;
        setFinalOutput((previous) => previous ?? outputs);
        setRunStatus("completed");
        setProgressPct(1);
        closeStream();
        return;
      }

      if (kind === "error") {
        setRunStatus("error");
        setRunError(
          typeof event.data?.message === "string" ? event.data.message : t("chat.runFailure"),
        );
        closeStream();
      }
    },
    [closeStream, t, traceId],
  );

  const startStream = useCallback(
    (runId: string) => {
      if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
        return;
      }
      closeStream();
      currentTraceRef.current = runId;
      try {
        const source = new window.EventSource(`/api/runs/${encodeURIComponent(runId)}/stream`);
        eventSourceRef.current = source;
        source.onopen = () => {
          retryAttemptRef.current = 0;
        };

        const relayEvent = (evt: MessageEvent) => {
          if (typeof evt.data !== "string") {
            return;
          }
          const payload = parseStreamPayload(evt.data);
          if (payload) {
            handleStreamEvent(payload);
          }
        };

        source.onmessage = relayEvent;

        const forwardEvent: EventListener = (event) => {
          relayEvent(event as MessageEvent);
        };

        const additionalEventTypes = [
          "run.started",
          "run.finished",
          "run.failed",
          "run.progress",
          "run.log",
          "run.ask",
          "run.score",
          "plan.updated",
          "tool.started",
          "tool.succeeded",
          "tool.failed",
          "agent.chat.msg",
          "agent.chat.message",
          "chat.msg",
          "chat.message",
          "user.confirm.request",
          "heartbeat",
        ];

        additionalEventTypes.forEach((eventType) => {
          source.addEventListener(eventType, forwardEvent);
        });

        source.onerror = () => {
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
          }
          const attempt = retryAttemptRef.current + 1;
          retryAttemptRef.current = attempt;
          const delay = Math.min(15000, 1000 * Math.pow(2, attempt - 1));
          if (typeof window !== "undefined") {
            if (retryTimerRef.current != null) {
              window.clearTimeout(retryTimerRef.current);
            }
            retryTimerRef.current = window.setTimeout(() => {
              if (currentTraceRef.current === runId) {
                startStream(runId);
              }
            }, delay);
          }
        };
      } catch (error) {
        console.error("failed to open run stream", error);
      }
    },
    [closeStream, handleStreamEvent],
  );

  const handleSaveConversation = useCallback(() => {
    const entries: Array<Record<string, unknown>> = chatHistory.map((message) => ({
      role: message.role,
      text: message.content,
      timestamp: message.ts,
      ...(message.msgId ? { msg_id: message.msgId } : {}),
      ...(message.traceId ? { trace_id: message.traceId } : {}),
      ...(message.status ? { status: message.status } : {}),
      ...(typeof message.latencyMs === "number" ? { latency_ms: message.latencyMs } : {}),
      ...(typeof message.cost === "number" ? { cost: message.cost } : {}),
      ...(message.error ? { error: message.error } : {}),
      ...(message.failureReason ? { failure_reason: message.failureReason } : {}),
      ...(message.reviewNotes && message.reviewNotes.length
        ? { review_notes: message.reviewNotes }
        : {}),
    }));

    if (draftInput) {
      entries.push({
        role: "user",
        text: draftInput,
        timestamp: new Date().toISOString(),
        draft: true,
      });
    }

    if (entries.length === 0) {
      return;
    }

    const blob = new Blob([JSON.stringify(entries, null, 2)], {
      type: "application/json",
    });
    const idPart = traceId ? `-${traceId}` : `-${Date.now()}`;
    const filename = `conversation${idPart}.json`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
  }, [chatHistory, draftInput, traceId]);

  const handleRun = useCallback(async () => {
    if (!draftInput || runStatus === "running" || runStatus === "awaiting-confirmation") {
      return;
    }

    const previousHistory = chatHistory;
    const previousTraceId = traceId;
    const createdAt = new Date().toISOString();
    const localId = generateLocalId();
    const userMessage: ChatHistoryMessage = {
      id: localId,
      role: "user",
      content: draftInput,
      ts: createdAt,
      status: "pending",
      traceId,
    };

    setChatHistory([...previousHistory, userMessage]);
    setRunStatus("running");
    resetForRun();
    setTraceId(undefined);
    setInput("");

    try {
      const serialisedHistory = serialiseHistoryForRequest(previousHistory);
      const messagesForRequest = serialisedHistory.map(({ role, content }) => ({ role, content }));

      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: draftInput,
          messages: messagesForRequest,
          history: serialisedHistory,
          ...(previousTraceId ? { trace_id: previousTraceId } : {}),
        }),
      });

      const data: ChatSendResponse | null = await response.json().catch(() => null);
      if (!response.ok || !data) {
        const errorMessage =
          (data?.error as { message?: string } | undefined)?.message ??
          t("errors.requestFailed", { status: response.status });
        throw new Error(errorMessage);
      }

      setChatHistory((history) =>
        history.map((message) =>
          message.id === localId
            ? {
                ...message,
                status: "sent",
              }
            : message,
        ),
      );

      setTraceId(data.trace_id);
      currentTraceRef.current = data.trace_id;

      if (Array.isArray(data.events)) {
        data.events.forEach((item, index) => {
          const envelope: StreamEventEnvelope = {
            id: `${item.span_id ?? "event"}-${index}-${generateLocalId()}`,
            ts: item.ts,
            type: item.type,
            trace_id: data.trace_id,
            span_id: item.span_id,
            parent_span_id: item.parent_span_id,
            data: item.data,
          };
          handleStreamEvent(envelope);
        });
      }

      if (data.result !== undefined) {
        setFinalOutput(data.result);
      }

      startStream(data.trace_id);
    } catch (err: any) {
      const errorMessage = err?.message ?? t("chat.runFailure");
      setRunError(errorMessage);
      setRunStatus("error");
      setChatHistory((history) => {
        const updated = history.map((message) =>
          message.id === localId
            ? {
                ...message,
                status: "error" as const,
                error: errorMessage,
              }
            : message,
        );
        const entry: ChatHistoryMessage = {
          id: generateLocalId(),
          role: "system",
          content: t("chat.errorPrefix", { message: errorMessage }),
          ts: new Date().toISOString(),
          status: "error",
          error: errorMessage,
        };
        return [...updated, entry];
      });
      setTraceId(previousTraceId);
    }
  }, [chatHistory, draftInput, handleStreamEvent, resetForRun, runStatus, startStream, t, traceId]);

  const handleSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    (event) => {
      event.preventDefault();
      void handleRun();
    },
    [handleRun],
  );

  const handleDecision = useCallback(
    (decision: "approve" | "reject") => {
      if (!confirmationRequest) return;
      setConfirmationRequest(null);
      const now = new Date().toISOString();
      setChatHistory((history) => [
        ...history,
        {
          id: generateLocalId(),
          role: "system",
          content:
            decision === "approve"
              ? t("confirmation.approved", { message: confirmationRequest.message })
              : t("confirmation.denied", { message: confirmationRequest.message }),
          ts: now,
          status: "done",
        },
      ]);
      if (decision === "approve") {
        setRunStatus("running");
      } else {
        setRunStatus("error");
        setRunError(t("confirmation.deniedStatus"));
        closeStream();
      }
    },
    [closeStream, confirmationRequest, t],
  );

  const tabItems = useMemo(
    () => [
      { id: "chat" as const, label: t("layout.tabs.chat") },
      { id: "logflow" as const, label: t("layout.tabs.logflow") },
    ],
    [t],
  );

  const statusText = useMemo(() => {
    if (runStatus === "error") {
      return runError ?? t("chat.statusIndicator.error");
    }
    if (runStatus === "running") {
      return t("chat.statusIndicator.running");
    }
    if (runStatus === "awaiting-confirmation") {
      return t("chat.statusIndicator.awaitingConfirmation");
    }
    if (chatHistory.length > 0) {
      return t("chat.statusIndicator.ready");
    }
    return t("chat.statusIndicator.idle");
  }, [chatHistory.length, runError, runStatus, t]);

  const statusTone =
    runStatus === "error"
      ? "text-orange-300"
      : runStatus === "running"
        ? "text-sky-200"
        : runStatus === "awaiting-confirmation"
          ? "text-amber-200"
          : "text-slate-200";

  const disableSave = !chatHistory.length && !draftInput;

  const metrics = useMemo(() => {
    let cost = 0;
    let latency = 0;
    let tokens = 0;
    for (const event of skillEvents) {
      if (event.type === "tool" && event.status !== "started") {
        if (typeof event.cost === "number") cost += event.cost;
        if (typeof event.latencyMs === "number") latency += event.latencyMs;
        if (typeof event.tokens === "number") tokens += event.tokens;
      }
    }
    return { cost, latency, tokens };
  }, [skillEvents]);

  const formatDateTime = useCallback(
    (value: string) => {
      try {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
          return value;
        }
        return new Intl.DateTimeFormat(locale, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }).format(date);
      } catch {
        return value;
      }
    },
    [locale],
  );

  const planLabels = useMemo(
    () => ({
      heading: t("panels.plan.heading"),
      filterPlaceholder: t("panels.plan.filter"),
      collapse: t("panels.plan.collapse"),
      expand: t("panels.plan.expand"),
      empty: t("panels.plan.empty"),
      updatedAt: (value: string) => t("panels.plan.updatedAt", { value: formatDateTime(value) }),
      revision: (value?: number) =>
        value != null ? t("panels.plan.revision", { value }) : t("panels.plan.revisionUnknown"),
      reason: (value?: string) =>
        value && value.length > 0
          ? t("panels.plan.reason", { reason: value })
          : t("panels.plan.reasonUnknown"),
      stepCount: (count: number) => t("panels.plan.stepCount", { count }),
    }),
    [formatDateTime, t],
  );

  const skillLabels = useMemo(
    () => ({
      heading: t("panels.skills.heading"),
      filterPlaceholder: t("panels.skills.filter"),
      collapse: t("panels.skills.collapse"),
      expand: t("panels.skills.expand"),
      empty: t("panels.skills.empty"),
      status: {
        started: t("panels.skills.status.started"),
        succeeded: t("panels.skills.status.succeeded"),
        failed: t("panels.skills.status.failed"),
      },
      metricLabels: {
        latency: t("chat.metrics.latency"),
        cost: t("chat.metrics.cost"),
        tokens: t("chat.metrics.tokens"),
      },
      metrics: {
        cost: (value?: number | null) =>
          typeof value === "number" ? value.toFixed(4) : t("panels.skills.metric.na"),
        latency: (value?: number | null) =>
          typeof value === "number" ? `${value.toFixed(0)} ms` : t("panels.skills.metric.na"),
        tokens: (value?: number | null) =>
          typeof value === "number" ? value.toLocaleString() : t("panels.skills.metric.na"),
      },
      noteLabel: (level?: string) =>
        level && level.length > 0
          ? t("panels.skills.noteLabel", { level })
          : t("panels.skills.note"),
      scoreNote: t("panels.skills.score"),
    }),
    [t],
  );

  return (
    <div className={shellClass} data-testid="chat-shell">
      <header className={`${headerSurfaceClass} px-6 py-8 sm:px-8`} data-testid="chat-header">
        <div className="mx-auto w-full max-w-6xl space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-50">
            {t("layout.title")}
          </h1>
          <p className={`${subtleTextClass} max-w-3xl text-sm sm:text-base`}>
            {t("layout.subtitle")}
          </p>
        </div>
      </header>

      <main className={`${pageContainerClass} space-y-8`} data-testid="chat-main">
        <nav
          aria-label={t("layout.tabs.chat")}
          className={`${pillGroupClass} mx-auto max-w-md`}
          data-testid="chat-nav"
        >
          {tabItems.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-pressed={selected}
                className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 ${
                  selected
                    ? "bg-sky-400 text-slate-950 shadow-[0_12px_30px_rgba(56,189,248,0.35)]"
                    : "text-slate-300 hover:bg-slate-800/60 hover:text-slate-100"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {activeTab === "chat" ? (
          <div
            className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]"
            data-testid="chat-layout"
          >
            <section
              aria-labelledby="conversation-title"
              className={`${panelSurfaceClass} space-y-6 p-6 sm:p-8`}
              data-testid="conversation-panel"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2">
                  <h3 id="conversation-title" className={headingClass}>
                    {t("conversation.heading")}
                  </h3>
                  <p className={`${subtleTextClass} text-xs sm:text-sm`}>
                    {traceId
                      ? t("conversation.traceNotice", { traceId })
                      : t("conversation.traceNotice", { traceId: "…" })}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-3 text-xs sm:text-sm">
                  {traceId ? (
                    <span className="flex items-center gap-2 truncate text-sky-200">
                      <span className={`${badgeClass} bg-sky-500/10 text-sky-100`}>episodes</span>
                      <span className="truncate text-slate-200">episodes/{traceId}.jsonl</span>
                      <a
                        className="text-sky-300 underline decoration-dotted underline-offset-4 transition hover:text-sky-100"
                        href={`/api/episodes/${traceId}`}
                      >
                        {t("conversation.downloadJsonl")}
                      </a>
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleSaveConversation}
                    disabled={disableSave}
                    className={`${outlineButtonClass} whitespace-nowrap`}
                  >
                    {t("conversation.saveButton")}
                  </button>
                </div>
              </div>

              <ChatMessageList messages={chatHistory} isRunning={runStatus === "running"} />

              {draftInput ? (
                <div
                  className={`${insetSurfaceClass} border-dashed border-slate-700/60 bg-slate-950/40 p-4`}
                >
                  <div className={`${labelClass} text-slate-400`}>
                    {t("conversation.draftLabel")}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">{draftInput}</p>
                </div>
              ) : null}

              {finalOutput ? (
                <div className="space-y-3">
                  <div className={`${labelClass} text-slate-400`}>
                    {t("conversation.finalOutputTitle")}
                  </div>
                  <pre className="max-h-72 overflow-auto rounded-2xl border border-slate-800/70 bg-slate-950/60 p-4 text-xs leading-relaxed text-slate-200">
                    {JSON.stringify(finalOutput, null, 2)}
                  </pre>
                </div>
              ) : null}

              <form onSubmit={handleSubmit} className="space-y-4">
                <label htmlFor="prompt" className={`${labelClass} text-slate-300`}>
                  {t("chat.inputLabel")}
                </label>
                <textarea
                  id="prompt"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void handleRun();
                    }
                  }}
                  placeholder={t("chat.placeholder")}
                  className={`${inputSurfaceClass} min-h-[9rem] w-full resize-y`}
                />
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="submit"
                    disabled={runStatus === "running" || runStatus === "awaiting-confirmation"}
                    className={`${primaryButtonClass} w-full sm:w-auto`}
                  >
                    {runStatus === "running"
                      ? t("chat.submit.running")
                      : runStatus === "awaiting-confirmation"
                        ? t("chat.submit.confirming")
                        : t("chat.submit.run")}
                  </button>
                  <span className={`${subtleTextClass} text-sm`}>{statusText}</span>
                </div>
              </form>
            </section>

            <div className="grid gap-6" data-testid="sidebar-panels">
              <section
                aria-labelledby="run-stats-title"
                className={`${panelSurfaceClass} space-y-6 p-6 sm:p-7`}
                data-testid="run-stats-panel"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 id="run-stats-title" className={headingClass}>
                    {t("chat.metrics.heading")}
                  </h3>
                  <span className={`${badgeClass} ${statusTone} bg-transparent normal-case`}>
                    {statusText}
                  </span>
                </div>
                <dl className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <dt className={`${labelClass} text-slate-400`}>{t("chat.metrics.traceId")}</dt>
                    <dd className="font-mono text-sm text-slate-200">{traceId ?? "–"}</dd>
                  </div>
                  <div className="space-y-2">
                    <dt className={`${labelClass} text-slate-400`}>{t("chat.metrics.progress")}</dt>
                    <dd className="text-sm text-slate-200">
                      {typeof progressPct === "number" ? `${Math.round(progressPct * 100)}%` : "–"}
                    </dd>
                  </div>
                  <div className="space-y-2">
                    <dt className={`${labelClass} text-slate-400`}>{t("chat.metrics.latency")}</dt>
                    <dd className="text-sm text-slate-200">
                      {metrics.latency > 0 ? `${metrics.latency.toFixed(0)} ms` : "–"}
                    </dd>
                  </div>
                  <div className="space-y-2">
                    <dt className={`${labelClass} text-slate-400`}>{t("chat.metrics.cost")}</dt>
                    <dd className="text-sm text-slate-200">
                      {metrics.cost > 0 ? metrics.cost.toFixed(4) : "–"}
                    </dd>
                  </div>
                  <div className="space-y-2">
                    <dt className={`${labelClass} text-slate-400`}>{t("chat.metrics.tokens")}</dt>
                    <dd className="text-sm text-slate-200">
                      {metrics.tokens > 0 ? metrics.tokens.toLocaleString() : "–"}
                    </dd>
                  </div>
                </dl>
                {runError ? (
                  <p className="rounded-2xl border border-orange-500/50 bg-orange-500/10 px-4 py-3 text-sm text-orange-200">
                    {runError}
                  </p>
                ) : (
                  <p className={`${subtleTextClass} text-xs`}>
                    {t("chat.metrics.streamingNotice")}
                  </p>
                )}
              </section>

              <section
                aria-labelledby="raw-response-title"
                className={`${panelSurfaceClass} space-y-4 p-6 sm:p-7`}
                data-testid="raw-response-panel"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 id="raw-response-title" className={headingClass}>
                    {t("chat.latestResponse")}
                  </h3>
                  {lastEvent ? (
                    <span className={`${badgeClass} bg-sky-500/10 text-sky-100`}>updated</span>
                  ) : null}
                </div>
                <pre className="max-h-[28rem] overflow-auto rounded-2xl border border-slate-800/70 bg-slate-950/60 p-4 text-xs leading-relaxed text-slate-200">
                  {lastEvent ? JSON.stringify(lastEvent, null, 2) : t("chat.noResponse")}
                </pre>
              </section>

              <section
                className={`${panelSurfaceClass} space-y-6 p-6 sm:p-7`}
                data-testid="plan-panel"
              >
                <PlanTimeline
                  events={planEvents}
                  filter={planFilter}
                  collapsed={planCollapsed}
                  onFilterChange={setPlanFilter}
                  onToggleCollapse={() => setPlanCollapsed((value) => !value)}
                  labels={planLabels}
                />
              </section>

              <section
                className={`${panelSurfaceClass} space-y-6 p-6 sm:p-7`}
                data-testid="skill-panel-wrapper"
              >
                <SkillPanel
                  events={skillEvents}
                  filter={skillFilter}
                  collapsed={skillCollapsed}
                  onFilterChange={setSkillFilter}
                  onToggleCollapse={() => setSkillCollapsed((value) => !value)}
                  labels={skillLabels}
                />
              </section>
            </div>
          </div>
        ) : (
          <section className={`${panelSurfaceClass} p-6 sm:p-8`}>
            <LogFlowPanel traceId={traceId} />
          </section>
        )}
      </main>

      {confirmationRequest ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-6">
          <div className={modalBackdropClass} aria-hidden="true" />
          <div
            className={modalSurfaceClass}
            role="dialog"
            aria-modal="true"
            data-testid="confirmation-modal"
          >
            <div className="space-y-4">
              <div>
                <h2 className={`${headingClass} text-xl`}>{t("confirmation.title")}</h2>
                <p className={`${subtleTextClass} text-sm`}>{t("confirmation.subtitle")}</p>
              </div>
              <div className={`${insetSurfaceClass} border border-amber-500/50 bg-amber-500/5 p-4`}>
                <p className="text-sm text-amber-100">{confirmationRequest.message}</p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  className={`${outlineButtonClass} w-full sm:w-auto`}
                  onClick={() => handleDecision("reject")}
                >
                  {t("confirmation.reject")}
                </button>
                <button
                  type="button"
                  className={`${primaryButtonClass} w-full sm:w-auto`}
                  onClick={() => handleDecision("approve")}
                >
                  {t("confirmation.approve")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default HomePage;

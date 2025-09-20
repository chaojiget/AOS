import { FormEventHandler, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NextPage } from "next";
import { useRouter } from "next/router";

import ChatMessageList, { type ChatHistoryMessage } from "../components/ChatMessageList";
<<<<<<< HEAD
import HeaderPrimaryNav, { type HeaderPrimaryNavItem } from "../components/HeaderPrimaryNav";
=======
import FinalReplyCard from "../components/chat/FinalReplyCard";
>>>>>>> origin/codex/refactor-finalpreview-to-a-component
import LogFlowPanel from "../components/LogFlowPanel";
import PlanTimeline, {
  type PlanTimelineEvent,
  type PlanTimelineStep,
} from "../components/PlanTimeline";
import SkillPanel, { type SkillEvent } from "../components/SkillPanel";
import RunStatusIndicator, { type RunIndicatorState } from "../components/RunStatusIndicator";
import { useLocalToast } from "../components/useLocalToast";
import { fetchEpisodeDetail, fetchEpisodes, type EpisodeListItem } from "../lib/episodes";
import { useI18n } from "../lib/i18n/index";
import {
  fetchGuardianBudget,
  subscribeGuardianAlerts,
  submitGuardianApproval,
  type GuardianAlert,
  type GuardianAlertEvent,
  type GuardianBudget,
  type GuardianBudgetStatus,
} from "../lib/guardian/index";
import {
  badgeClass,
  headerSurfaceClass,
  headingClass,
  inputSurfaceClass,
  insetSurfaceClass,
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
  tool?: string;
}

interface FinalReplySnapshot {
  id: string;
  ts: string;
  content: string;
  traceId?: string | null;
}

type RunStatus = "idle" | "running" | "awaiting-confirmation" | "completed" | "error";

type GuardianStatusKey = GuardianBudgetStatus | "loading" | "idle" | "error";

const GUARDIAN_STATUS_TONES: Record<GuardianStatusKey, string> = {
  ok: "bg-emerald-500/10 text-emerald-200",
  warning: "bg-amber-500/10 text-amber-200",
  critical: "bg-rose-500/10 text-rose-200",
  loading: "bg-slate-700/30 text-slate-200",
  idle: "bg-slate-700/30 text-slate-200",
  error: "bg-rose-500/10 text-rose-200",
};

const GUARDIAN_SEVERITY_TONES: Record<GuardianAlert["severity"], string> = {
  info: "bg-slate-700/40 text-slate-100",
  warning: "bg-amber-500/10 text-amber-200",
  critical: "bg-rose-500/10 text-rose-200",
};

const GUARDIAN_ALERT_STATUS_TONES: Record<GuardianAlert["status"], string> = {
  open: "bg-sky-500/10 text-sky-200",
  approved: "bg-emerald-500/10 text-emerald-200",
  rejected: "bg-rose-500/10 text-rose-200",
  resolved: "bg-slate-700/40 text-slate-100",
};

const EPISODE_SKELETON_ITEMS = new Array(6).fill(null);

const DRAWER_TRANSITION_MS = 16;

const useDrawerMount = (open: boolean, durationMs: number): boolean => {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (open) {
      setMounted(true);
    } else if (mounted) {
      timeout = setTimeout(() => {
        setMounted(false);
      }, durationMs);
    }
    return () => {
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [open, mounted, durationMs]);

  return mounted;
};

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
  const router = useRouter();
  const { ToastContainer, showToast, dismissToast } = useLocalToast();
  const [input, setInput] = useState("");
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [traceId, setTraceId] = useState<string | undefined>(undefined);
  const [chatHistory, setChatHistory] = useState<ChatHistoryMessage[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"chat" | "logflow">("chat");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const sidebarSheetMounted = useDrawerMount(sidebarOpen, DRAWER_TRANSITION_MS);
  const insightsSheetMounted = useDrawerMount(insightsOpen, DRAWER_TRANSITION_MS);
  const sidebarSheetRef = useRef<HTMLDivElement | null>(null);
  const insightsSheetRef = useRef<HTMLDivElement | null>(null);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [finalOutput, setFinalOutput] = useState<unknown>(null);
  const [finalReplyHistory, setFinalReplyHistory] = useState<FinalReplySnapshot[]>([]);
  const [finalReplyHistoryOpen, setFinalReplyHistoryOpen] = useState(false);
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
  const [guardianBudget, setGuardianBudget] = useState<GuardianBudget | null>(null);
  const [guardianAlerts, setGuardianAlerts] = useState<GuardianAlert[]>([]);
  const [guardianLoading, setGuardianLoading] = useState(true);
  const [guardianError, setGuardianError] = useState<string | null>(null);
  const [guardianStreamError, setGuardianStreamError] = useState<string | null>(null);
  const [guardianSubmissions, setGuardianSubmissions] = useState<
    Record<string, "pending" | "success" | "error">
  >({});
  const [debugOpen, setDebugOpen] = useState(false);
  const [episodes, setEpisodes] = useState<EpisodeListItem[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [episodesError, setEpisodesError] = useState<string | null>(null);
  const [episodeFilter, setEpisodeFilter] = useState("");
  const [draftEpisode, setDraftEpisode] = useState<EpisodeListItem | null>(null);
  const [activeEpisodeId, setActiveEpisodeId] = useState<string | null>(null);
  const [loadingEpisodeId, setLoadingEpisodeId] = useState<string | null>(null);
  const [downloadingEpisodeId, setDownloadingEpisodeId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const currentTraceRef = useRef<string | undefined>(undefined);
<<<<<<< HEAD
  const helpDialogRef = useRef<HTMLDivElement | null>(null);
  const helpCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
=======
  const finalReplyHighlightTimeoutRef = useRef<number | null>(null);
  const finalReplyHighlightTargetRef = useRef<string | null>(null);
>>>>>>> origin/codex/refactor-finalpreview-to-a-component

  const draftInput = useMemo(() => input.trim(), [input]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("app-theme");
    if (stored === "dark" || stored === "light") {
      setTheme(stored);
      return;
    }
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
      setTheme("light");
    }
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = theme;
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem("app-theme", theme);
    }
  }, [theme]);

  useEffect(() => {
    if (!helpOpen) {
      return;
    }
    const dialog = helpDialogRef.current;
    if (!dialog) {
      return;
    }

    previouslyFocusedElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      ),
    );

    const focusTarget = helpCloseButtonRef.current ?? focusable[0] ?? null;
    if (focusTarget) {
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => {
          focusTarget.focus();
        });
      } else {
        focusTarget.focus();
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setHelpOpen(false);
        return;
      }
      if (event.key === "Tab" && focusable.length > 0) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey) {
          if (document.activeElement === first || document.activeElement === dialog) {
            event.preventDefault();
            last.focus();
          }
        } else if (document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocusedElementRef.current) {
        previouslyFocusedElementRef.current.focus();
      }
    };
  }, [helpOpen]);

  const refreshEpisodes = useCallback(async () => {
    setEpisodesLoading(true);
    setEpisodesError(null);
    try {
      const response = await fetchEpisodes();
      const items = response?.data?.items ?? [];
      setEpisodes(items);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("conversation.episodes.loadErrorFallback");
      setEpisodesError(message);
      showToast({
        title: t("toast.error.title"),
        message,
        dismissLabel: t("toast.dismiss"),
        actionLabel: t("toast.action.retry"),
        onAction: () => {
          void refreshEpisodes();
        },
        tone: "error",
      });
    } finally {
      setEpisodesLoading(false);
    }
  }, [showToast, t]);

  const resetForRun = useCallback(() => {
    setPlanEvents([]);
    setSkillEvents([]);
    setFinalOutput(null);
    setFinalReplyHistory([]);
    setFinalReplyHistoryOpen(false);
    setLastEvent(null);
    setPlanFilter("");
    setSkillFilter("");
    setPlanCollapsed(false);
    setSkillCollapsed(false);
    setConfirmationRequest(null);
    setProgressPct(null);
    setRunError(null);
    if (typeof document !== "undefined" && finalReplyHighlightTargetRef.current) {
      const target = document.getElementById(
        `chat-message-${finalReplyHighlightTargetRef.current}`,
      );
      if (target) {
        target.classList.remove("ring-2", "ring-sky-400", "ring-offset-2", "ring-offset-slate-950");
      }
      finalReplyHighlightTargetRef.current = null;
    }
    if (finalReplyHighlightTimeoutRef.current != null && typeof window !== "undefined") {
      window.clearTimeout(finalReplyHighlightTimeoutRef.current);
      finalReplyHighlightTimeoutRef.current = null;
    }
  }, []);

  const handleToggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
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

  useEffect(() => {
    refreshEpisodes().catch(() => {});
  }, [refreshEpisodes]);

  useEffect(() => {
    if (traceId) {
      setActiveEpisodeId(traceId);
      if (draftEpisode && draftEpisode.trace_id !== traceId) {
        setDraftEpisode(null);
      }
    }
  }, [draftEpisode, traceId]);

  const appendSystemMessage = useCallback(
    (content: string, status: ChatHistoryMessage["status"] = "done") => {
      setChatHistory((history) => [
        ...history,
        {
          id: generateLocalId(),
          role: "system",
          content,
          ts: new Date().toISOString(),
          status,
        },
      ]);
    },
    [],
  );

  useEffect(() => {
    let active = true;
    setGuardianLoading(true);
    fetchGuardianBudget()
      .then((budget) => {
        if (!active) return;
        setGuardianBudget(budget);
        setGuardianError(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setGuardianError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (active) {
          setGuardianLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const upsertGuardianAlert = useCallback((updated: GuardianAlert) => {
    setGuardianAlerts((current) => {
      const index = current.findIndex((item) => item.id === updated.id);
      const next =
        index >= 0
          ? current.map((item, position) => (position === index ? { ...item, ...updated } : item))
          : [...current, updated];
      next.sort((a, b) => {
        const aTime = Date.parse(a.updatedAt ?? a.createdAt ?? "");
        const bTime = Date.parse(b.updatedAt ?? b.createdAt ?? "");
        return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
      });
      return next.slice(0, 10);
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return () => {};
    }
    const unsubscribe = subscribeGuardianAlerts({
      onEvent: (event: GuardianAlertEvent) => {
        if (event.budget) {
          setGuardianBudget(event.budget);
          setGuardianError(null);
          setGuardianLoading(false);
        }
        if (event.alert) {
          upsertGuardianAlert(event.alert);
        }
        setGuardianStreamError(null);
      },
      onError: (error) => {
        setGuardianStreamError(error.message);
      },
    });
    return unsubscribe;
  }, [upsertGuardianAlert]);

  useEffect(() => {
    if (sidebarOpen) {
      sidebarSheetRef.current?.focus();
    }
  }, [sidebarOpen]);

  useEffect(() => {
    if (insightsOpen) {
      insightsSheetRef.current?.focus();
    }
  }, [insightsOpen]);

  useEffect(() => {
    if (!sidebarOpen && !insightsOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSidebarOpen(false);
        setInsightsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [sidebarOpen, insightsOpen]);

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
        const requestId =
          typeof event.data?.request_id === "string"
            ? event.data.request_id
            : typeof event.id === "string"
              ? event.id
              : generateLocalId();
        setConfirmationRequest({
          id: requestId,
          ts: event.ts ?? new Date().toISOString(),
          message: prompt,
          context: event.data,
          level: event.data?.level,
          tool: typeof event.data?.tool === "string" ? event.data.tool : undefined,
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
        setFinalOutput((previous: unknown) =>
          previous === null || previous === undefined ? outputs : previous,
        );
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
      showToast({
        title: t("toast.info.title"),
        message: t("chat.toast.noContent"),
        dismissLabel: t("toast.dismiss"),
        tone: "info",
      });
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
    showToast({
      title: t("toast.success.title"),
      message: t("chat.toast.saveSuccess"),
      dismissLabel: t("toast.dismiss"),
      tone: "success",
    });
  }, [chatHistory, draftInput, showToast, t, traceId]);

  const handleCreateConversation = useCallback(() => {
    closeStream();
    resetForRun();
    setChatHistory([]);
    setTraceId(undefined);
    currentTraceRef.current = undefined;
    setRunStatus("idle");
    setRunError(null);
    setInput("");
    dismissToast();

    const draftId = `draft-${generateLocalId()}`;
    const now = new Date().toISOString();
    const placeholder: EpisodeListItem = {
      trace_id: draftId,
      status: "draft",
      started_at: now,
      finished_at: null,
      goal: t("conversation.episodes.draftTitle"),
      step_count: 0,
      score: null,
    };
    setDraftEpisode(placeholder);
    setActiveEpisodeId(draftId);
    setEpisodeFilter("");
  }, [closeStream, dismissToast, resetForRun, t]);

  const handleLoadEpisode = useCallback(
    async (targetTraceId: string) => {
      dismissToast();
      setLoadingEpisodeId(targetTraceId);
      try {
        const response = await fetchEpisodeDetail(targetTraceId);
        const detail = response.data;
        const events = Array.isArray(detail?.events) ? detail.events : [];

        closeStream();
        resetForRun();
        setChatHistory([]);
        setTraceId(targetTraceId);
        currentTraceRef.current = targetTraceId;
        setRunStatus("idle");
        setRunError(null);
        setInput("");

        const sortedEvents = [...events].sort(
          (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
        );
        sortedEvents.forEach((event) => {
          const envelope: StreamEventEnvelope = {
            id: event.id ?? generateLocalId(),
            ts: event.ts,
            type: event.type,
            trace_id: targetTraceId,
            span_id: event.span_id ?? undefined,
            parent_span_id: event.parent_span_id ?? undefined,
            data: event.data,
          };
          handleStreamEvent(envelope);
        });
        setRunStatus("idle");

        setActiveEpisodeId(targetTraceId);
        setDraftEpisode(null);
        setEpisodes((items) => {
          const next = [...items];
          const index = next.findIndex((item) => item.trace_id === targetTraceId);
          const fallback = index >= 0 ? next[index] : undefined;
          const enrichedMetadata: EpisodeListItem = {
            trace_id: detail?.trace_id ?? targetTraceId,
            status: detail?.status ?? fallback?.status ?? "completed",
            started_at: detail?.started_at ?? fallback?.started_at ?? new Date().toISOString(),
            finished_at: detail?.finished_at ?? fallback?.finished_at,
            goal: detail?.goal ?? fallback?.goal,
            step_count: detail?.step_count ?? fallback?.step_count,
            score: detail?.score ?? fallback?.score,
          };
          if (index >= 0) {
            next[index] = { ...next[index], ...enrichedMetadata };
          } else {
            next.unshift(enrichedMetadata);
          }
          return next;
        });

        showToast({
          title: t("toast.success.title"),
          message: t("conversation.episodes.loadSuccess", { traceId: targetTraceId }),
          tone: "success",
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t("conversation.episodes.loadError", { traceId: targetTraceId });
        showToast({
          title: t("toast.error.title"),
          message,
          tone: "error",
        });
      } finally {
        setLoadingEpisodeId(null);
      }
    },
    [closeStream, dismissToast, handleStreamEvent, resetForRun, showToast, t],
  );

  const handleDownloadEpisode = useCallback(
    async (targetTraceId: string) => {
      dismissToast();
      setDownloadingEpisodeId(targetTraceId);
      try {
        const response = await fetch(`/api/episodes/${encodeURIComponent(targetTraceId)}`);
        if (!response.ok) {
          throw new Error(t("conversation.episodes.downloadError", { traceId: targetTraceId }));
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `episodes-${targetTraceId}.jsonl`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 0);
        showToast({
          title: t("toast.success.title"),
          message: t("conversation.episodes.downloadSuccess", { traceId: targetTraceId }),
          tone: "success",
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t("conversation.episodes.downloadError", { traceId: targetTraceId });
        showToast({
          title: t("toast.error.title"),
          message,
          tone: "error",
        });
      } finally {
        setDownloadingEpisodeId(null);
      }
    },
    [dismissToast, showToast, t],
  );

  const handleRun = useCallback(async () => {
    const awaitingConfirmation = runStatus === "awaiting-confirmation";
    if (!draftInput) {
      showToast({
        title: t("toast.info.title"),
        message: t("chat.toast.emptyInput"),
        dismissLabel: t("toast.dismiss"),
        tone: "info",
      });
      if (promptInputRef.current) {
        promptInputRef.current.focus();
      }
      return;
    }
    if (runStatus === "running" || awaitingConfirmation) {
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
      msgId: localId,
    };

    setChatHistory([...previousHistory, userMessage]);
    setRunStatus("running");
    resetForRun();
    setTraceId(undefined);
    setInput("");

    try {
      const serialisedHistory = serialiseHistoryForRequest(previousHistory);
      const messagesForRequest = serialisedHistory.map(({ role, content }) => ({ role, content }));
      const shouldReuseTrace = awaitingConfirmation && previousTraceId;

      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: draftInput,
          messages: messagesForRequest,
          history: serialisedHistory,
          ...(shouldReuseTrace ? { trace_id: shouldReuseTrace } : {}),
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
      showToast({
        title: t("toast.error.title"),
        message: errorMessage,
        dismissLabel: t("toast.dismiss"),
        tone: "error",
      });
    }
  }, [
    chatHistory,
    draftInput,
    handleStreamEvent,
    resetForRun,
    runStatus,
    showToast,
    startStream,
    t,
    traceId,
  ]);

  const handleSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    (event) => {
      event.preventDefault();
      void handleRun();
    },
    [handleRun],
  );

  const handleDecision = useCallback(
    (decision: "approve" | "reject") => {
      if (!confirmationRequest || !traceId) {
        return;
      }
      const pendingRequest = confirmationRequest;
      setConfirmationRequest(null);
      const requestBody = {
        requestId: pendingRequest.id,
        decision,
      };

      void (async () => {
        try {
          const response = await fetch(`/api/runs/${encodeURIComponent(traceId)}/approval`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
          });

          if (!response.ok) {
            let errorMessage = t("chat.runFailure");
            try {
              const payload = await response.json();
              if (typeof payload?.error?.message === "string") {
                errorMessage = payload.error.message;
              }
            } catch {
              // ignore json parse errors
            }
            throw new Error(errorMessage);
          }

          const now = new Date().toISOString();
          setChatHistory((history) => [
            ...history,
            {
              id: generateLocalId(),
              role: "system",
              content:
                decision === "approve"
                  ? t("confirmation.approved", { message: pendingRequest.message })
                  : t("confirmation.denied", { message: pendingRequest.message }),
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
        } catch (error) {
          const message =
            error instanceof Error && error.message ? error.message : t("chat.runFailure");
          setRunStatus("error");
          setRunError(message);
          setChatHistory((history) => [
            ...history,
            {
              id: generateLocalId(),
              role: "system",
              content: t("chat.errorPrefix", { message }),
              ts: new Date().toISOString(),
              status: "error",
              error: message,
            },
          ]);
          closeStream();
        }
      })();
    },
    [closeStream, confirmationRequest, t, traceId],
  );

  const handleGuardianDecision = useCallback(
    (alertId: string, decision: "approve" | "reject") => {
      setGuardianSubmissions((previous) => ({ ...previous, [alertId]: "pending" }));
      void submitGuardianApproval({ alertId, decision })
        .then((result) => {
          if (result.alert) {
            upsertGuardianAlert(result.alert);
          } else {
            setGuardianAlerts((current) => {
              const index = current.findIndex((item) => item.id === alertId);
              if (index === -1) {
                return current;
              }
              const next = [...current];
              next[index] = { ...next[index], status: result.status };
              return next;
            });
          }
          setGuardianSubmissions((previous) => ({ ...previous, [alertId]: "success" }));
        })
        .catch((error: unknown) => {
          console.warn("Guardian approval failed", error);
          setGuardianSubmissions((previous) => ({ ...previous, [alertId]: "error" }));
          const fallback = t("guardian.alerts.error");
          const message =
            error instanceof Error && error.message ? `${fallback} (${error.message})` : fallback;
          showToast({
            title: t("toast.error.title"),
            message,
            dismissLabel: t("toast.dismiss"),
            tone: "error",
          });
        });
    },
    [showToast, t, upsertGuardianAlert],
  );

  const primaryNavItems = useMemo<HeaderPrimaryNavItem[]>(
    () =>
      [
        { href: "/", label: t("layout.nav.chat") },
        { href: "/episodes", label: t("layout.nav.episodes") },
        { href: "/skills", label: t("layout.nav.skills") },
      ].map((item) => ({
        ...item,
        isActive: router.pathname === item.href,
      })),
    [router.pathname, t],
  );

  const tabItems = useMemo(
    () => [
      { id: "chat" as const, label: t("layout.tabs.chat") },
      { id: "logflow" as const, label: t("layout.tabs.logflow") },
    ],
    [t],
  );

  const runIndicator = useMemo((): { label: string; state: RunIndicatorState } => {
    if (runStatus === "error") {
      return {
        state: "error",
        label: runError ?? t("chat.statusIndicator.error"),
      };
    }
    if (runStatus === "running") {
      return {
        state: "running",
        label: t("chat.statusIndicator.running"),
      };
    }
    if (runStatus === "awaiting-confirmation") {
      return {
        state: "running",
        label: t("chat.statusIndicator.awaitingConfirmation"),
      };
    }
    if (chatHistory.length > 0) {
      return {
        state: "idle",
        label: t("chat.statusIndicator.ready"),
      };
    }
    return {
      state: "idle",
      label: t("chat.statusIndicator.idle"),
    };
  }, [chatHistory.length, runError, runStatus, t]);

  const runStatusLabel = runIndicator.label;
  const runIndicatorState = runIndicator.state;

  const themeToggleText =
    theme === "dark" ? t("layout.themeToggle.light") : t("layout.themeToggle.dark");
  const themeToggleDescription =
    theme === "dark" ? t("layout.themeToggle.toLight") : t("layout.themeToggle.toDark");
  const helpButtonLabel = t("layout.help.button");
  const helpButtonDescription = t("layout.help.ariaLabel");
  const primaryNavLabel = t("layout.primaryNavLabel");
  const helpShortcuts = useMemo(
    () => [
      {
        id: "run",
        keys: t("layout.help.shortcuts.run.keys"),
        description: t("layout.help.shortcuts.run.description"),
      },
      {
        id: "newline",
        keys: t("layout.help.shortcuts.newline.keys"),
        description: t("layout.help.shortcuts.newline.description"),
      },
      {
        id: "focus",
        keys: t("layout.help.shortcuts.focus.keys"),
        description: t("layout.help.shortcuts.focus.description"),
      },
    ],
    [t],
  );

  const helpCommands = useMemo(
    () => [
      { id: "refresh", description: t("layout.help.commands.refresh") },
      { id: "download", description: t("layout.help.commands.download") },
      { id: "theme", description: t("layout.help.commands.theme") },
    ],
    [t],
  );

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

  const guardianStatusKey: GuardianStatusKey = guardianError
    ? "error"
    : guardianLoading
      ? "loading"
      : guardianBudget
        ? guardianBudget.status
        : "idle";
  const guardianStatusTone = GUARDIAN_STATUS_TONES[guardianStatusKey];
  const guardianStatusLabel = t(`guardian.status.${guardianStatusKey}`);

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

  const formatCurrencyValue = useCallback(
    (value?: number | null, currency?: string) => {
      if (typeof value !== "number" || Number.isNaN(value)) {
        return "–";
      }
      const unit = currency && currency.length > 0 ? currency : "USD";
      try {
        return new Intl.NumberFormat(locale, { style: "currency", currency: unit }).format(value);
      } catch {
        return `${value.toFixed(2)} ${unit}`;
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

  const finalPreview = useMemo(() => {
    if (finalOutput == null) {
      return null;
    }
    if (typeof finalOutput === "string") {
      return finalOutput;
    }
    if (Array.isArray(finalOutput)) {
      return finalOutput
        .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
        .join("\n");
    }
    if (typeof finalOutput === "object") {
      const output = finalOutput as Record<string, unknown>;
      if (typeof output.text === "string") {
        return output.text;
      }
      if (typeof output.message === "string") {
        return output.message;
      }
    }
    return null;
  }, [finalOutput]);

  useEffect(() => {
    if (!finalPreview) {
      return;
    }
    const text = finalPreview.trim();
    if (!text) {
      return;
    }
    setFinalReplyHistory((history) => {
      const last = history[history.length - 1];
      if (last && last.content === text) {
        return history;
      }
      return [
        ...history,
        {
          id: generateLocalId(),
          ts: new Date().toISOString(),
          content: text,
          traceId: traceId ?? currentTraceRef.current ?? null,
        },
      ];
    });
  }, [finalPreview, traceId]);

  const finalReplyMessageId = useMemo(() => {
    for (let index = chatHistory.length - 1; index >= 0; index -= 1) {
      const message = chatHistory[index];
      if (message.role === "assistant") {
        return message.id;
      }
    }
    return null;
  }, [chatHistory]);

  const sortedFinalReplyHistory = useMemo(
    () =>
      [...finalReplyHistory].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()),
    [finalReplyHistory],
  );

  const handleCopyFinalReply = useCallback(() => {
    if (!finalPreview) {
      return;
    }
    const text = finalPreview;

    const copy = async () => {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
      if (typeof document !== "undefined") {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        const successful = document.execCommand?.("copy");
        document.body.removeChild(textarea);
        if (!successful) {
          throw new Error("copy-failed");
        }
        return;
      }
      throw new Error("copy-unsupported");
    };

    void (async () => {
      try {
        await copy();
        showToast({
          title: t("toast.success.title"),
          message: t("conversation.finalReply.copySuccess"),
          dismissLabel: t("toast.dismiss"),
          tone: "success",
        });
      } catch {
        showToast({
          title: t("toast.error.title"),
          message: t("conversation.finalReply.copyError"),
          dismissLabel: t("toast.dismiss"),
          tone: "error",
        });
      }
    })();
  }, [finalPreview, showToast, t]);

  const handleLocateFinalReply = useCallback(() => {
    if (!finalReplyMessageId) {
      showToast({
        title: t("toast.info.title"),
        message: t("conversation.finalReply.locateUnavailable"),
        dismissLabel: t("toast.dismiss"),
        tone: "info",
      });
      return;
    }
    if (typeof document === "undefined") {
      return;
    }

    if (
      finalReplyHighlightTargetRef.current &&
      finalReplyHighlightTargetRef.current !== finalReplyMessageId
    ) {
      const previous = document.getElementById(
        `chat-message-${finalReplyHighlightTargetRef.current}`,
      );
      if (previous) {
        previous.classList.remove(
          "ring-2",
          "ring-sky-400",
          "ring-offset-2",
          "ring-offset-slate-950",
        );
      }
    }

    const element = document.getElementById(`chat-message-${finalReplyMessageId}`);
    if (!element) {
      showToast({
        title: t("toast.error.title"),
        message: t("conversation.finalReply.locateError"),
        dismissLabel: t("toast.dismiss"),
        tone: "error",
      });
      return;
    }

    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.classList.add("ring-2", "ring-sky-400", "ring-offset-2", "ring-offset-slate-950");
    finalReplyHighlightTargetRef.current = finalReplyMessageId;

    if (typeof window !== "undefined") {
      if (finalReplyHighlightTimeoutRef.current != null) {
        window.clearTimeout(finalReplyHighlightTimeoutRef.current);
      }
      const highlightId = finalReplyMessageId;
      finalReplyHighlightTimeoutRef.current = window.setTimeout(() => {
        const target = document.getElementById(`chat-message-${highlightId}`);
        if (target) {
          target.classList.remove(
            "ring-2",
            "ring-sky-400",
            "ring-offset-2",
            "ring-offset-slate-950",
          );
        }
        if (finalReplyHighlightTargetRef.current === highlightId) {
          finalReplyHighlightTargetRef.current = null;
        }
        finalReplyHighlightTimeoutRef.current = null;
      }, 1600);
    }
  }, [finalReplyMessageId, showToast, t]);

  const handleOpenFinalReplyHistory = useCallback(() => {
    setFinalReplyHistoryOpen(true);
  }, []);

  const handleCloseFinalReplyHistory = useCallback(() => {
    setFinalReplyHistoryOpen(false);
  }, []);

  const episodeItems = useMemo(() => {
    if (!draftEpisode) {
      return episodes;
    }
    const withoutDraft = episodes.filter((item) => item.trace_id !== draftEpisode.trace_id);
    return [draftEpisode, ...withoutDraft];
  }, [draftEpisode, episodes]);

  const filteredEpisodes = useMemo(() => {
    const keyword = episodeFilter.trim().toLowerCase();
    if (!keyword) {
      return episodeItems;
    }
    return episodeItems.filter((item) => {
      const text = `${item.trace_id} ${item.goal ?? ""} ${item.status}`.toLowerCase();
      return text.includes(keyword);
    });
  }, [episodeFilter, episodeItems]);

  const renderSidebar = () => (
    <>
      <section className={`${panelSurfaceClass} space-y-4 p-5 sm:p-6`}>
        <div className="space-y-1">
          <h3 className={headingClass}>{t("conversation.heading")}</h3>
          <p className={`${subtleTextClass} text-xs sm:text-sm`}>
            {traceId
              ? t("conversation.traceNotice", { traceId })
              : t("conversation.traceNotice", { traceId: "…" })}
          </p>
        </div>
        <div className="flex flex-col gap-3 text-xs sm:flex-row sm:items-center sm:justify-between sm:text-sm">
          {traceId ? (
            <span className="flex items-center gap-2 truncate text-sky-200">
              <span className={`${badgeClass} bg-sky-500/10 text-sky-100`}>episodes</span>
              <span className="truncate text-slate-200">episodes/{traceId}.jsonl</span>
            </span>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {traceId ? (
              <a
                className={`${outlineButtonClass} px-3 py-1 text-xs sm:text-sm`}
                href={`/api/episodes/${traceId}`}
              >
                {t("conversation.downloadJsonl")}
              </a>
            ) : null}
            <button
              type="button"
              onClick={handleSaveConversation}
              disabled={disableSave}
              className={`${primaryButtonClass} px-3 py-1 text-xs sm:text-sm`}
            >
              {t("conversation.saveButton")}
            </button>
          </div>
        </div>
      </section>

      {draftInput ? (
        <section className={`${panelSurfaceClass} space-y-3 p-5 sm:p-6`}>
          <div className={`${labelClass} text-slate-400`}>{t("conversation.draftLabel")}</div>
          <p className="whitespace-pre-wrap text-sm text-slate-200">{draftInput}</p>
        </section>
      ) : null}
    </>
  );

  const renderInsights = () => (
    <>
      <section
        aria-labelledby="guardian-panel-title"
        className={`${panelSurfaceClass} space-y-6 p-6 sm:p-7`}
        data-testid="guardian-panel"
      >
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h3 id="guardian-panel-title" className={headingClass}>
                {t("guardian.heading")}
              </h3>
              <p className={`${subtleTextClass} text-xs`}>{t("guardian.subtitle")}</p>
            </div>
            <span className={`${badgeClass} ${guardianStatusTone} normal-case`}>
              {guardianStatusLabel}
            </span>
          </div>
          {guardianError ? (
            <p className="text-xs text-rose-200">
              {t("guardian.error.detail", { message: guardianError })}
            </p>
          ) : null}
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <dt className={`${labelClass} text-slate-400`}>{t("guardian.budget.limit")}</dt>
              <dd className="text-sm text-slate-200">
                {guardianBudget
                  ? formatCurrencyValue(guardianBudget.limit, guardianBudget.currency)
                  : "–"}
              </dd>
            </div>
            <div className="space-y-2">
              <dt className={`${labelClass} text-slate-400`}>{t("guardian.budget.used")}</dt>
              <dd className="text-sm text-slate-200">
                {guardianBudget
                  ? formatCurrencyValue(guardianBudget.used, guardianBudget.currency)
                  : "–"}
              </dd>
            </div>
            <div className="space-y-2">
              <dt className={`${labelClass} text-slate-400`}>{t("guardian.budget.remaining")}</dt>
              <dd className="text-sm text-slate-200">
                {guardianBudget
                  ? formatCurrencyValue(guardianBudget.remaining, guardianBudget.currency)
                  : "–"}
              </dd>
            </div>
          </dl>
          {guardianBudget?.updatedAt ? (
            <p className={`${subtleTextClass} text-xs`}>
              {t("guardian.budget.updatedAt", {
                value: formatDateTime(guardianBudget.updatedAt),
              })}
            </p>
          ) : null}
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h4 className={`${labelClass} text-slate-300`}>{t("guardian.alerts.heading")}</h4>
            <span className={`${badgeClass} bg-slate-900/70 text-slate-300`}>
              {guardianAlerts.length}
            </span>
          </div>
          {guardianStreamError ? (
            <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-100">
              {t("guardian.alerts.streamError")}
            </p>
          ) : null}
          {guardianAlerts.length === 0 ? (
            <p className={`${subtleTextClass} text-sm`}>
              {guardianLoading
                ? t("guardian.alerts.loading")
                : guardianError
                  ? t("guardian.alerts.streamError")
                  : t("guardian.alerts.empty")}
            </p>
          ) : (
            <ul className="space-y-3">
              {guardianAlerts.map((alert) => {
                const submissionState = guardianSubmissions[alert.id];
                const isPending = submissionState === "pending";
                const replayHref =
                  alert.replayUrl ??
                  alert.detailsUrl ??
                  (alert.traceId ? `/episodes/${alert.traceId}` : null);
                const showApproval = alert.requireApproval && alert.status === "open";
                return (
                  <li
                    key={alert.id}
                    className={`${insetSurfaceClass} border border-slate-800/70 bg-slate-950/50 p-4`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-2">
                        <p className="text-sm text-slate-100">{alert.message}</p>
                        <div className="flex flex-wrap gap-2">
                          <span
                            className={`${badgeClass} ${GUARDIAN_SEVERITY_TONES[alert.severity]}`}
                          >
                            {t(`guardian.alerts.severity.${alert.severity}`)}
                          </span>
                          <span
                            className={`${badgeClass} ${GUARDIAN_ALERT_STATUS_TONES[alert.status]}`}
                          >
                            {t(`guardian.alerts.status.${alert.status}`)}
                          </span>
                        </div>
                        <p className={`${subtleTextClass} text-xs`}>
                          {formatDateTime(alert.updatedAt ?? alert.createdAt)}
                        </p>
                      </div>
                      {replayHref ? (
                        <a
                          href={replayHref}
                          target="_blank"
                          rel="noreferrer"
                          className={`${outlineButtonClass} px-3 py-1.5 text-xs`}
                        >
                          {t("guardian.alerts.replay")}
                        </a>
                      ) : null}
                    </div>
                    {showApproval ? (
                      <div className="flex flex-wrap gap-3 pt-3">
                        <button
                          type="button"
                          onClick={() => handleGuardianDecision(alert.id, "approve")}
                          disabled={isPending}
                          className={`${primaryButtonClass} px-3 py-1.5 text-xs`}
                        >
                          {t("guardian.alerts.approve")}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleGuardianDecision(alert.id, "reject")}
                          disabled={isPending}
                          className={`${outlineButtonClass} px-3 py-1.5 text-xs`}
                        >
                          {t("guardian.alerts.reject")}
                        </button>
                      </div>
                    ) : null}
                    {submissionState === "success" ? (
                      <p className={`${subtleTextClass} pt-2 text-xs`}>
                        {t("guardian.alerts.submitted")}
                      </p>
                    ) : null}
                    {submissionState === "error" ? (
                      <p className="pt-2 text-xs text-rose-200">{t("guardian.alerts.error")}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section
        aria-labelledby="run-stats-title"
        className={`${panelSurfaceClass} space-y-6 p-6 sm:p-7`}
        data-testid="run-stats-panel"
      >
        <div className="flex items-center justify-between gap-3">
          <h3 id="run-stats-title" className={headingClass}>
            {t("chat.metrics.heading")}
          </h3>
          <RunStatusIndicator
            state={runIndicatorState}
            label={runStatusLabel}
            size="sm"
            data-testid="panel-run-status"
          />
        </div>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <dt className={`${labelClass} text-slate-400`}>{t("chat.metrics.traceId")}</dt>
            <dd className="font-mono text-sm text-slate-200 theme-text-strong">{traceId ?? "–"}</dd>
          </div>
          <div className="space-y-2">
            <dt className={`${labelClass} text-slate-400`}>{t("chat.metrics.progress")}</dt>
            <dd className="text-sm text-slate-200 theme-text-strong">
              {typeof progressPct === "number" ? `${Math.round(progressPct * 100)}%` : "–"}
            </dd>
          </div>
          <div className="space-y-2">
            <dt className={`${labelClass} text-slate-400`}>{t("chat.metrics.latency")}</dt>
            <dd className="text-sm text-slate-200 theme-text-strong">
              {metrics.latency > 0 ? `${metrics.latency.toFixed(0)} ms` : "–"}
            </dd>
          </div>
          <div className="space-y-2">
            <dt className={`${labelClass} text-slate-400`}>{t("chat.metrics.cost")}</dt>
            <dd className="text-sm text-slate-200 theme-text-strong">
              {metrics.cost > 0 ? metrics.cost.toFixed(4) : "–"}
            </dd>
          </div>
          <div className="space-y-2">
            <dt className={`${labelClass} text-slate-400`}>{t("chat.metrics.tokens")}</dt>
            <dd className="text-sm text-slate-200 theme-text-strong">
              {metrics.tokens > 0 ? metrics.tokens.toLocaleString() : "–"}
            </dd>
          </div>
        </dl>
        {runError ? (
          <p className="rounded-2xl border border-orange-500/50 bg-orange-500/10 px-4 py-3 text-sm text-orange-200">
            {runError}
          </p>
        ) : (
          <p className={`${subtleTextClass} text-xs`}>{t("chat.metrics.streamingNotice")}</p>
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
          <button
            type="button"
            onClick={() => setDebugOpen((value) => !value)}
            className={`${outlineButtonClass} px-3 py-1 text-xs`}
          >
            {debugOpen ? t("panels.plan.collapse") : t("panels.plan.expand")}
          </button>
        </div>
        {debugOpen ? (
          <pre className="max-h-[28rem] overflow-auto rounded-2xl border border-slate-800/70 bg-slate-950/60 p-4 text-xs leading-relaxed text-slate-200">
            {lastEvent ? JSON.stringify(lastEvent, null, 2) : t("chat.noResponse")}
          </pre>
        ) : (
          <p className={`${subtleTextClass} text-xs`}>
            {lastEvent ? t("chat.metrics.streamingNotice") : t("chat.noResponse")}
          </p>
        )}
      </section>

      <section className={`${panelSurfaceClass} space-y-6 p-6 sm:p-7`} data-testid="plan-panel">
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
    </>
  );

  const chatPanel = (
    <section
      aria-labelledby="tab-chat conversation-title"
      className={`${panelSurfaceClass} flex flex-col gap-6 p-6 sm:p-8`}
      data-testid="conversation-panel"
      id="chat-panel"
      role="tabpanel"
    >
      <h3 id="conversation-title" className="sr-only">
        {t("conversation.heading")}
      </h3>
      <div
        className="flex flex-col gap-6 md:flex-1 md:min-h-0 md:overflow-y-auto md:pb-6"
        data-testid="chat-scroll-region"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <RunStatusIndicator
            state={runIndicatorState}
            label={runStatusLabel}
            size="sm"
            data-testid="conversation-run-status"
          />
          {traceId ? (
            <span className="font-mono text-xs text-slate-400 theme-text-muted sm:text-sm">
              {traceId}
            </span>
          ) : null}
        </div>

        <ChatMessageList messages={chatHistory} isRunning={runStatus === "running"} />

        {finalPreview ? (
          <div className={`${insetSurfaceClass} border border-sky-500/40 bg-sky-500/5 p-4`}>
            <div className={`${labelClass} text-sky-200`}>{t("conversation.finalOutputTitle")}</div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-100">{finalPreview}</p>
          </div>
        ) : null}
      </div>

<<<<<<< HEAD
      <div className="md:sticky md:bottom-0 md:left-0 md:right-0 md:pt-2">
        <form
          onSubmit={handleSubmit}
          className="space-y-4 md:rounded-3xl md:border md:border-slate-800/60 md:bg-slate-950/70 md:p-5 md:shadow-[0_-16px_40px_rgba(15,23,42,0.35)]"
        >
          <label htmlFor="prompt" className={`${labelClass} text-slate-300`}>
            {t("chat.inputLabel")}
          </label>
          <textarea
            id="prompt"
            ref={promptInputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void handleRun();
              }
            }}
            placeholder={t("chat.placeholder")}
            aria-describedby="chat-input-hint"
            aria-keyshortcuts="Control+Enter Meta+Enter"
            className={`${inputSurfaceClass} min-h-[9rem] w-full resize-y`}
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="submit"
              disabled={
                !draftInput || runStatus === "running" || runStatus === "awaiting-confirmation"
              }
              className={`${primaryButtonClass} w-full sm:w-auto`}
              aria-keyshortcuts="Control+Enter Meta+Enter"
            >
              {runStatus === "running"
                ? t("chat.submit.running")
                : runStatus === "awaiting-confirmation"
                  ? t("chat.submit.confirming")
                  : t("chat.submit.run")}
            </button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className={`${subtleTextClass} text-sm`} id="chat-input-hint">
              {t("chat.inputShortcutHint")}
            </span>
            <span className={`${subtleTextClass} text-sm`} aria-live="polite">
              {runStatusLabel}
            </span>
          </div>
        </form>
      </div>
=======
      <FinalReplyCard
        label={t("conversation.finalReply.title")}
        content={finalPreview ?? ""}
        sticky
        historyCount={finalReplyHistory.length}
        anchorId={finalReplyMessageId ?? undefined}
        onCopy={handleCopyFinalReply}
        onLocate={handleLocateFinalReply}
        onOpenHistory={handleOpenFinalReplyHistory}
      />

      <ChatMessageList messages={chatHistory} isRunning={runStatus === "running"} />

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
>>>>>>> origin/codex/refactor-finalpreview-to-a-component
    </section>
  );

  const logflowPanel = (
    <section
      className={`${panelSurfaceClass} p-6 sm:p-8`}
      data-testid="logflow-panel"
      id="logflow-panel"
      role="tabpanel"
      aria-labelledby="tab-logflow"
    >
      <LogFlowPanel traceId={traceId} />
    </section>
  );

  const sidebarDrawerId = "mobile-sidebar-drawer";
  const insightsDrawerId = "mobile-insights-drawer";
  const activePanel = activeTab === "chat" ? chatPanel : logflowPanel;

  return (
    <div className={shellClass} data-testid="chat-shell">
      <header className={`${headerSurfaceClass} px-6 py-8 sm:px-8`} data-testid="chat-header">
        <div className="mx-auto w-full max-w-6xl space-y-6">
          <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
            <div className="flex items-center gap-4">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-400 text-lg font-black text-slate-950 shadow-[0_18px_45px_rgba(56,189,248,0.35)]">
                A
              </span>
              <div>
                <span className={labelClass}>{t("layout.productLabel")}</span>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-50 theme-heading sm:text-3xl">
                  {t("layout.title")}
                </h1>
              </div>
            </div>
            <HeaderPrimaryNav
              items={primaryNavItems}
              ariaLabel={primaryNavLabel}
              data-testid="primary-nav"
              className="flex justify-center"
            />
            <div className="flex flex-wrap items-center justify-start gap-3 lg:justify-end">
              <RunStatusIndicator
                state={runIndicatorState}
                label={runStatusLabel}
                size="sm"
                data-testid="header-run-status"
              />
              <button
                type="button"
                onClick={() => setHelpOpen(true)}
                className={`${outlineButtonClass} px-3 py-1 text-xs`}
                aria-haspopup="dialog"
                aria-expanded={helpOpen}
                aria-controls="help-overlay"
                aria-label={helpButtonDescription}
                data-testid="help-trigger"
              >
                {helpButtonLabel}
              </button>
              <button
                type="button"
                onClick={handleToggleTheme}
                className={`${outlineButtonClass} px-3 py-1 text-xs`}
                aria-label={themeToggleDescription}
                data-testid="theme-toggle"
              >
                {themeToggleText}
              </button>
            </div>
          </div>
          <p className={`${subtleTextClass} max-w-3xl text-sm sm:text-base`}>
            {t("layout.subtitle")}
          </p>
        </div>
      </header>

      <main className={`${pageContainerClass} space-y-8`} data-testid="chat-main">
        <nav
          aria-label={`${t("layout.tabs.chat")} / ${t("layout.tabs.logflow")}`}
          className={`${pillGroupClass} mx-auto max-w-md`}
          data-testid="chat-nav"
          role="tablist"
        >
          {tabItems.map((tab) => {
            const selected = activeTab === tab.id;
            const tabId = `tab-${tab.id}`;
            const panelId = tab.id === "chat" ? "chat-panel" : "logflow-panel";
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                id={tabId}
                aria-controls={panelId}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 ${
                  selected
                    ? "bg-sky-400 text-slate-950 shadow-[0_12px_30px_rgba(56,189,248,0.35)]"
                    : "text-slate-300 hover:bg-slate-800/60 hover:text-slate-100"
                }`}
                data-testid={`tab-button-${tab.id}`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div
          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between xl:hidden"
          data-testid="mobile-pane-toggles"
        >
          <button
            type="button"
            className={`${outlineButtonClass} w-full sm:w-auto`}
            onClick={() => {
              setSidebarOpen(true);
              setInsightsOpen(false);
            }}
            aria-controls={sidebarDrawerId}
            aria-expanded={sidebarOpen}
            aria-haspopup="dialog"
            data-testid="chat-sidebar-toggle"
          >
            {t("conversation.heading")}
          </button>
          <button
            type="button"
            className={`${outlineButtonClass} w-full sm:w-auto`}
            onClick={() => {
              setInsightsOpen(true);
              setSidebarOpen(false);
            }}
            aria-controls={insightsDrawerId}
            aria-expanded={insightsOpen}
            aria-haspopup="dialog"
            data-testid="chat-insights-toggle"
          >
            {t("guardian.heading")}
          </button>
        </div>

        <div
          className="mx-auto grid w-full max-w-6xl gap-6 xl:grid-cols-shell"
          data-testid="chat-layout"
        >
          <aside
            className="hidden xl:flex xl:flex-col xl:space-y-6"
            data-testid="chat-sidebar"
            aria-label={t("conversation.heading")}
          >
            {renderSidebar()}
          </aside>

          <div className="min-w-0">{activePanel}</div>

          <aside
            className="hidden xl:flex xl:flex-col xl:space-y-6"
            data-testid="chat-insights"
            aria-label={t("guardian.heading")}
          >
            {renderInsights()}
          </aside>
        </div>

        {sidebarSheetMounted ? (
          <div
            className={`fixed inset-0 z-40 flex xl:hidden transition-opacity duration-16 ${
              sidebarOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
            }`}
            role="presentation"
            aria-hidden={!sidebarOpen}
            data-testid="chat-sidebar-sheet-backdrop"
          >
            <div
              className={`absolute inset-0 bg-slate-950/80 transition-opacity duration-16 ${
                sidebarOpen ? "opacity-100" : "opacity-0"
              }`}
              aria-hidden="true"
              onClick={() => setSidebarOpen(false)}
            />
            <div
              ref={sidebarSheetRef}
              className={`relative flex h-full w-full max-w-xs flex-col overflow-y-auto bg-slate-950 p-6 shadow-xl outline-none transition-transform duration-16 ease-out sm:max-w-sm ${
                sidebarOpen ? "translate-x-0" : "-translate-x-full"
              }`}
              role="dialog"
              aria-modal={sidebarOpen}
              aria-label={t("conversation.heading")}
              id={sidebarDrawerId}
              tabIndex={-1}
              data-testid="chat-sidebar-sheet"
            >
              <div className="mb-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  className={`${outlineButtonClass} px-3 py-1 text-xs`}
                  aria-label={`${t("conversation.heading")} ${t("panels.plan.collapse")}`}
                >
                  {t("panels.plan.collapse")}
                </button>
              </div>
              <div className="space-y-6">{renderSidebar()}</div>
            </div>
          </div>
        ) : null}

        {insightsSheetMounted ? (
          <div
            className={`fixed inset-0 z-40 flex xl:hidden transition-opacity duration-16 ${
              insightsOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
            }`}
            role="presentation"
            aria-hidden={!insightsOpen}
            data-testid="chat-insights-sheet-backdrop"
          >
            <div
              className={`absolute inset-0 bg-slate-950/80 transition-opacity duration-16 ${
                insightsOpen ? "opacity-100" : "opacity-0"
              }`}
              aria-hidden="true"
              onClick={() => setInsightsOpen(false)}
            />
            <div
              ref={insightsSheetRef}
              className={`relative ml-auto flex h-full w-full max-w-xs flex-col overflow-y-auto bg-slate-950 p-6 shadow-xl outline-none transition-transform duration-16 ease-out sm:max-w-sm ${
                insightsOpen ? "translate-x-0" : "translate-x-full"
              }`}
              role="dialog"
              aria-modal={insightsOpen}
              aria-label={t("guardian.heading")}
              id={insightsDrawerId}
              tabIndex={-1}
              data-testid="chat-insights-sheet"
            >
              <div className="mb-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setInsightsOpen(false)}
                  className={`${outlineButtonClass} px-3 py-1 text-xs`}
                  aria-label={`${t("guardian.heading")} ${t("panels.plan.collapse")}`}
                >
                  {t("panels.plan.collapse")}
                </button>
              </div>
              <div className="space-y-6">{renderInsights()}</div>
            </div>
          </div>
        ) : null}
      </main>
<<<<<<< HEAD
      {helpOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          role="presentation"
          data-testid="help-overlay-backdrop"
        >
          <div
            className={modalBackdropClass}
            aria-hidden="true"
            onClick={() => setHelpOpen(false)}
          />
          <div
            ref={helpDialogRef}
            className={`${modalSurfaceClass} max-h-[80vh] w-full max-w-2xl overflow-y-auto`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-dialog-title"
            aria-describedby="help-dialog-description"
            id="help-overlay"
            data-testid="help-overlay"
          >
            <div className="space-y-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2">
                  <h2 id="help-dialog-title" className={`${headingClass} text-2xl`}>
                    {t("layout.help.title")}
                  </h2>
                  <p id="help-dialog-description" className={`${subtleTextClass} text-sm`}>
                    {t("layout.help.subtitle")}
                  </p>
                </div>
                <button
                  type="button"
                  ref={helpCloseButtonRef}
                  className={`${outlineButtonClass} px-3 py-1 text-xs`}
                  onClick={() => setHelpOpen(false)}
                  data-testid="help-close"
                >
                  {t("layout.help.close")}
                </button>
              </div>
              <section
                aria-labelledby="help-shortcuts-heading"
                className={`${insetSurfaceClass} space-y-4 p-5`}
              >
                <div className="space-y-2">
                  <h3 id="help-shortcuts-heading" className={`${labelClass} text-xs`}>
                    {t("layout.help.shortcuts.title")}
                  </h3>
                  <p className={`${subtleTextClass} text-sm`}>
                    {t("layout.help.shortcuts.description")}
                  </p>
                </div>
                <ul className="space-y-3">
                  {helpShortcuts.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="font-mono text-sm text-slate-200 theme-text-strong">
                        {item.keys}
                      </span>
                      <span className={`${subtleTextClass} text-sm`}>{item.description}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <section
                aria-labelledby="help-commands-heading"
                className={`${insetSurfaceClass} space-y-4 p-5`}
              >
                <div className="space-y-2">
                  <h3 id="help-commands-heading" className={`${labelClass} text-xs`}>
                    {t("layout.help.commands.title")}
                  </h3>
                  <p className={`${subtleTextClass} text-sm`}>
                    {t("layout.help.commands.description")}
                  </p>
                </div>
                <ul className="space-y-3">
                  {helpCommands.map((item) => (
                    <li key={item.id} className={`${subtleTextClass} text-sm`}>
                      {item.description}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </div>
      ) : null}
=======

      {finalReplyHistoryOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-6">
          <div
            className={modalBackdropClass}
            aria-hidden="true"
            onClick={handleCloseFinalReplyHistory}
          />
          <div
            className={modalSurfaceClass}
            role="dialog"
            aria-modal="true"
            aria-labelledby="final-reply-history-title"
            data-testid="final-reply-history-modal"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id="final-reply-history-title" className={`${headingClass} text-xl`}>
                {t("conversation.finalReply.historyTitle")}
              </h2>
              <button
                type="button"
                onClick={handleCloseFinalReplyHistory}
                className={`${outlineButtonClass} px-3 py-1 text-xs`}
              >
                {t("conversation.finalReply.closeHistory")}
              </button>
            </div>
            {sortedFinalReplyHistory.length === 0 ? (
              <p className={`${subtleTextClass} mt-4 text-sm`}>
                {t("conversation.finalReply.historyEmpty")}
              </p>
            ) : (
              <ul className="mt-4 max-h-96 space-y-4 overflow-y-auto pr-1">
                {sortedFinalReplyHistory.map((entry, index) => (
                  <li
                    key={entry.id}
                    className={`${insetSurfaceClass} border border-slate-800/70 bg-slate-950/60 p-4`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className={`${labelClass} text-sky-200`}>
                        {t("conversation.finalReply.historyItem", {
                          index: sortedFinalReplyHistory.length - index,
                        })}
                      </span>
                      <span className={`${subtleTextClass} text-xs`}>
                        {formatDateTime(entry.ts)}
                      </span>
                    </div>
                    {entry.traceId ? (
                      <p className={`${subtleTextClass} mt-1 text-xs`}>
                        {t("conversation.finalReply.historyTrace", { traceId: entry.traceId })}
                      </p>
                    ) : null}
                    <p className="mt-3 whitespace-pre-wrap text-sm text-slate-100">
                      {entry.content}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

>>>>>>> origin/codex/refactor-finalpreview-to-a-component
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
      <ToastContainer />
    </div>
  );
};

export default HomePage;

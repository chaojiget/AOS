"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Bot,
  User,
  Handshake,
  ShieldCheck,
  Activity,
  Timer,
  Undo2,
  Sparkles,
  Layers,
  Gauge,
  HelpCircle,
  Eye,
  Play,
  Brain,
  AlertTriangle,
  ClipboardList,
  FileText,
  ListChecks,
  Route,
  ArrowUpRight,
} from "lucide-react";
import { getApiBaseUrl, getChatStreamEndpoint } from "@/lib/apiConfig";
import { getStoredApiToken, onApiTokenChange } from "@/lib/authToken";
import Link from "next/link";

type Primitive = "ask" | "show" | "do" | "watch" | "learn" | "negotiate";
type Channel = "intent" | "contract" | "trace" | "chat";

interface Message {
  id: string;
  content: string;
  role: "user" | "assistant";
  timestamp: Date;
  traceId?: string;
  primitive?: Primitive;
  channel?: Channel;
  meta?: string[];
}

interface ChatStats {
  totalMessages: number;
  responseTime: number;
  activeTraces: number;
}

type SessionMeta = { id: string; title: string };

interface StoredMessageRecord {
  id: string;
  content: string;
  role: Message["role"];
  timestamp: string;
  traceId?: string;
  primitive?: Primitive;
  channel?: Channel;
  meta?: string[];
}

type ValueEventType = "progress" | "approval" | "anomaly" | "receipt";
type ValueEventStatus = "active" | "success" | "warning" | "error";

interface ValueEvent {
  id: string;
  title: string;
  type: ValueEventType;
  status: ValueEventStatus;
  timestamp: string;
  timeLabel?: string;
  summary: string;
  traceId?: string;
  actionLabel?: string;
  actionHref?: string;
}

interface RawValueEvent {
  id: string;
  eventType: string;
  status: string;
  occurredAt: string;
  title?: string | null;
  summary?: string | null;
  traceId?: string | null;
  payload?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  action?: {
    label?: string | null;
    href?: string | null;
  } | null;
}

type ContractStatus = "draft" | "awaiting-approval" | "executing";

type StepStatus = "pending" | "running" | "done" | "blocked";

interface ContractStep {
  id: string;
  title: string;
  status: StepStatus;
  evidence?: string;
  traceId?: string;
}

interface ContractOption {
  id: string;
  title: string;
  recommended: boolean;
  confidence: number;
  cost: string;
  duration: string;
  tradeOff: string;
  fallback?: string;
  steps: ContractStep[];
}

interface ContractWatcher {
  label: string;
  value: string;
  description?: string;
}

interface ContractTvo {
  test: string[];
  verify: string[];
  override: string[];
}

interface ContractSnapshot {
  goal: string;
  constraints: string[];
  resources: string[];
  riskBudget: string;
  status: ContractStatus;
  generatedAt: string;
  confidence: number;
  options: ContractOption[];
  watchers: ContractWatcher[];
  tvo: ContractTvo;
}

interface IntentDraft {
  goal: string;
  constraints: string;
  resources: string;
  riskBudget: string;
}

const parseListInput = (value: string): string[] =>
  value
    .split(/[\n,，;；]/)
    .map(item => item.trim())
    .filter(Boolean);

const capPercentage = (value: number) => Math.max(0.05, Math.min(0.99, Number(value.toFixed(2))));

const isStoredMessageRecord = (value: unknown): value is StoredMessageRecord => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string"
    && typeof record.content === "string"
    && (record.role === "user" || record.role === "assistant")
    && typeof record.timestamp === "string"
    && (record.traceId === undefined || typeof record.traceId === "string")
    && (record.primitive === undefined
      || record.primitive === "ask"
      || record.primitive === "show"
      || record.primitive === "do"
      || record.primitive === "watch"
      || record.primitive === "learn"
      || record.primitive === "negotiate")
    && (record.channel === undefined
      || record.channel === "intent"
      || record.channel === "contract"
      || record.channel === "trace"
      || record.channel === "chat")
    && (record.meta === undefined || Array.isArray(record.meta))
  );
};

const isSessionMeta = (value: unknown): value is SessionMeta => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.title === "string";
};

const primitiveMeta: Record<Primitive, { label: string; icon: JSX.Element; tone: string }> = {
  ask: { label: "澄清", icon: <HelpCircle className="h-3.5 w-3.5" />, tone: "bg-blue-100 text-blue-600 dark:bg-blue-500/10 dark:text-blue-200" },
  show: { label: "证据", icon: <Eye className="h-3.5 w-3.5" />, tone: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-200" },
  do: { label: "执行", icon: <Play className="h-3.5 w-3.5" />, tone: "bg-indigo-100 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-200" },
  watch: { label: "监控", icon: <Activity className="h-3.5 w-3.5" />, tone: "bg-amber-100 text-amber-600 dark:bg-amber-500/10 dark:text-amber-200" },
  learn: { label: "学习", icon: <Brain className="h-3.5 w-3.5" />, tone: "bg-purple-100 text-purple-600 dark:bg-purple-500/10 dark:text-purple-200" },
  negotiate: { label: "议定", icon: <Handshake className="h-3.5 w-3.5" />, tone: "bg-slate-100 text-slate-700 dark:bg-slate-500/10 dark:text-slate-200" },
};

const eventTypeMeta: Record<ValueEventType, { label: string; accent: string }> = {
  progress: { label: "任务进度", accent: "border-blue-400 bg-blue-50 dark:border-blue-500/60 dark:bg-blue-500/10" },
  approval: { label: "审批请求", accent: "border-amber-400 bg-amber-50 dark:border-amber-500/60 dark:bg-amber-500/10" },
  anomaly: { label: "异常告警", accent: "border-red-400 bg-red-50 dark:border-red-500/60 dark:bg-red-500/10" },
  receipt: { label: "结果回执", accent: "border-emerald-400 bg-emerald-50 dark:border-emerald-500/60 dark:bg-emerald-500/10" },
};

const eventStatusTone: Record<ValueEventStatus, string> = {
  active: "text-blue-600 dark:text-blue-300",
  success: "text-emerald-600 dark:text-emerald-300",
  warning: "text-amber-600 dark:text-amber-300",
  error: "text-red-600 dark:text-red-300",
};

const buildContractSnapshot = (intent: IntentDraft, events: ValueEvent[]): ContractSnapshot => {
  const constraints = parseListInput(intent.constraints);
  const resources = parseListInput(intent.resources);
  const successCount = events.filter(item => item.status === "success").length;
  const warningCount = events.filter(item => item.status === "warning").length;
  const errorCount = events.filter(item => item.status === "error").length;

  const confidence = capPercentage(0.62 + successCount * 0.08 - warningCount * 0.05 - errorCount * 0.12);
  const status: ContractStatus = errorCount > 0
    ? "awaiting-approval"
    : events.length > 0
      ? "executing"
      : "draft";

  const goal = intent.goal.trim() || "未命名目标";
  const riskBudget = intent.riskBudget.trim() || "默认：允许 5% 偏差 / 30 分钟延迟";

  const baseSteps: ContractStep[] = [
    {
      id: "intent",
      title: "解析意图并补全上下文",
      status: "done",
      evidence: "ICRP 对象已生成",
    },
    {
      id: "plan",
      title: "生成三套执行路径",
      status: events.length > 0 ? "done" : "running",
      evidence: `${successCount + warningCount + errorCount} 条价值事件参与评估`,
    },
    {
      id: "verify",
      title: "执行前验证 (Test/Verify)",
      status: warningCount > 0 ? "blocked" : events.length > 0 ? "running" : "pending",
      evidence: warningCount > 0 ? "等待人工批准" : "静态分析与风控通过",
      traceId: events.find(event => event.type === "approval")?.traceId,
    },
    {
      id: "act",
      title: "落地执行并追踪",
      status: status === "executing" ? "running" : "pending",
      evidence: `${events.length} 条 Trace 已接入 Plan-Act-Trace`,
      traceId: events.find(event => event.status === "success")?.traceId,
    },
  ];

  const alternativeTradeoff = (variant: "fast" | "safe"): string => {
    if (variant === "fast") {
      return "以时间优先，牺牲一部分精确度，约束放宽 10%";
    }
    return "以稳健优先，加入额外验证，执行时间 +30%";
  };

  const options: ContractOption[] = [
    {
      id: "primary",
      title: "主执行方案：逐步交付 + 实时校验",
      recommended: true,
      confidence,
      cost: resources.length > 0 ? `${resources.length} 项资源联动` : "单 Agent",
      duration: "预计 18 分钟",
      tradeOff: `风险预算：${riskBudget}`,
      fallback: "任何步骤失败即触发 Undo，回滚至最新稳定状态",
      steps: baseSteps,
    },
    {
      id: "fast",
      title: "备选 A：快速试探",
      recommended: false,
      confidence: capPercentage(confidence - 0.12),
      cost: "资源调用 -20%",
      duration: "预计 9 分钟",
      tradeOff: alternativeTradeoff("fast"),
      steps: baseSteps.map(step => ({ ...step, status: step.id === "verify" ? "pending" : step.status })),
    },
    {
      id: "safe",
      title: "备选 B：稳健复核",
      recommended: false,
      confidence: capPercentage(confidence - 0.04),
      cost: "加入双人复核",
      duration: "预计 26 分钟",
      tradeOff: alternativeTradeoff("safe"),
      steps: baseSteps.map(step => ({ ...step, status: step.id === "act" ? "pending" : step.status })),
    },
  ];

  const watchers: ContractWatcher[] = [
    {
      label: "置信区间",
      value: `${Math.round(confidence * 100)}%`,
      description: "根据最新价值事件动态更新",
    },
    {
      label: "下一次 Verify",
      value: new Date(Date.now() + 5 * 60 * 1000).toLocaleTimeString("zh-CN", { hour12: false }),
      description: "超过 1 秒需提示可中断",
    },
    {
      label: "可回滚窗口",
      value: "15 分钟",
      description: "Undo 钩子默认可用",
    },
  ];

  if (constraints.length > 0) {
    watchers.push({
      label: "关键约束",
      value: constraints.slice(0, 2).join(" / "),
      description: constraints.length > 2 ? "其余约束已入栈" : undefined,
    });
  }

  const tvo: ContractTvo = {
    test: [
      "静态检查：验证资源授权 Scope",
      "模拟执行：在影子环境生成差异 diff",
    ],
    verify: [
      "价值事件 ≥ 1 条 success 才可放权",
      "审批事件自动推送至命令面板",
    ],
    override: [
      "人工越权需声明原因并写入 Trace",
      "Undo2 钩子 3 步内可逆",
    ],
  };

  return {
    goal,
    constraints,
    resources,
    riskBudget,
    status,
    generatedAt: new Date().toISOString(),
    confidence,
    options,
    watchers,
    tvo,
  };
};

export default function ChatPage() {
  const [isClient, setIsClient] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string>("default");
  const [sessions, setSessionsState] = useState<SessionMeta[]>([]);
  const [valueEvents, setValueEvents] = useState<ValueEvent[]>([]);
  const [apiToken, setApiToken] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState<ChatStats>({
    totalMessages: 1,
    responseTime: 0,
    activeTraces: 1,
  });
  const [eventStreamSeed, setEventStreamSeed] = useState(0);
  const [contractSnapshot, setContractSnapshot] = useState<ContractSnapshot | null>(null);
  const [intentDraft, setIntentDraft] = useState<IntentDraft>({
    goal: "",
    constraints: "数据需符合政策 / 输出可复现",
    resources: "内部知识库, 第三方 API Token",
    riskBudget: "误差 ≤ 5%，时间 ≤ 30 分钟，成本 ≤ 200 元",
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const messageContainerRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    if (messageContainerRef.current) {
      messageContainerRef.current.scrollTop = messageContainerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    setIsClient(true);
    const cid = getConversationId();
    setConversationId(cid);
    const stored = loadMessages(cid);
    if (stored && stored.length) {
      setMessages(stored);
    } else {
      const welcome: Message = {
        id: "welcome",
        content: "欢迎回来！请描述目标、约束、资源与风险预算，我会为你生成可审计的执行契约。",
        role: "assistant",
        timestamp: new Date(),
        primitive: "show",
        channel: "intent",
      };
      setMessages([welcome]);
      saveMessages(cid, [welcome]);
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    setSessionsState(readSessionsFromStorage());
  }, []);

  useEffect(() => {
    if (!isClient) return;

    setApiToken(getStoredApiToken());

    const unsubscribe = onApiTokenChange((nextToken) => {
      const normalized = nextToken ?? null;
      setApiToken(prev => {
        if (prev === normalized) {
          return prev;
        }
        setEventStreamSeed(seed => seed + 1);
        return normalized;
      });
    });

    return () => {
      unsubscribe();
    };
  }, [isClient]);

  const mapRawEvent = useCallback((raw: RawValueEvent): ValueEvent => {
    const normalizedType = (() => {
      const base = raw.eventType?.toLowerCase?.() ?? "";
      if (base.includes("anomaly") || base.includes("error") || base.includes("incident")) {
        return "anomaly" as const;
      }
      if (base.includes("approval") || base.includes("review") || base.includes("acceptance")) {
        return "approval" as const;
      }
      if (base.includes("receipt") || base.includes("result") || base.includes("complete")) {
        return "receipt" as const;
      }
      return "progress" as const;
    })();

    const normalizedStatus = (() => {
      const base = raw.status?.toLowerCase?.() ?? "";
      if (["success", "succeeded", "done", "completed"].some(keyword => base.includes(keyword))) {
        return "success" as const;
      }
      if (["warning", "pending", "waiting", "approval"].some(keyword => base.includes(keyword))) {
        return "warning" as const;
      }
      if (["error", "failed", "anomaly", "incident"].some(keyword => base.includes(keyword))) {
        return "error" as const;
      }
      return "active" as const;
    })();

    const payload = raw.payload && typeof raw.payload === "object" ? raw.payload : {};
    const summaryCandidate =
      raw.summary
      ?? (typeof (payload as Record<string, unknown>).message === "string" ? (payload as Record<string, unknown>).message : undefined)
      ?? (typeof raw.title === "string" ? raw.title : undefined)
      ?? "收到价值事件通知";

    const timestamp = (() => {
      const parsed = new Date(raw.occurredAt);
      return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    })();

    const actionLabel = raw.action?.label ?? (raw.traceId ? "查看 Trace" : undefined);
    const actionHref = raw.action?.href ?? (raw.traceId ? `/telemetry?traceId=${encodeURIComponent(raw.traceId)}` : undefined);

    return {
      id: raw.id,
      title: raw.title ?? raw.eventType ?? "价值事件",
      type: normalizedType,
      status: normalizedStatus,
      timestamp: timestamp.toISOString(),
      timeLabel: timestamp.toLocaleTimeString("zh-CN", { hour12: false }),
      summary: summaryCandidate,
      traceId: raw.traceId ?? undefined,
      actionLabel,
      actionHref,
    } satisfies ValueEvent;
  }, []);

  const upsertValueEvent = useCallback((raw: RawValueEvent) => {
    const event = mapRawEvent(raw);
    setValueEvents(prev => {
      const filtered = prev.filter(item => item.id !== event.id);
      return [event, ...filtered].slice(0, 50);
    });
  }, [mapRawEvent]);

  useEffect(() => {
    if (!isClient || !apiToken) {
      return;
    }

    let cancelled = false;
    const base = getApiBaseUrl();

    const fetchInitial = async () => {
      try {
        const res = await fetch(`${base}/api/events?limit=30`, {
          headers: {
            Authorization: `Bearer ${apiToken}`,
          },
        });
        if (!res.ok) return;
        const json = await res.json();
        const events = Array.isArray(json.events) ? (json.events as RawValueEvent[]) : [];
        setValueEvents(events.map(mapRawEvent));
      } catch (error) {
        console.error("加载价值事件失败", error);
      }
    };

    fetchInitial();

    const source = new EventSource(`${base}/api/events/stream?token=${encodeURIComponent(apiToken)}`);

    source.onmessage = (event) => {
      try {
        const valueEvent = JSON.parse(event.data) as RawValueEvent;
        upsertValueEvent(valueEvent);
      } catch (error) {
        console.error("解析价值事件流失败", error);
      }
    };

    source.onerror = () => {
      source.close();
      if (!cancelled) {
        setTimeout(() => setEventStreamSeed(prev => prev + 1), 5000);
      }
    };

    return () => {
      cancelled = true;
      source.close();
    };
  }, [apiToken, isClient, eventStreamSeed, mapRawEvent, upsertValueEvent]);

  const getConversationId = () => {
    if (typeof window === "undefined") return "default";
    const key = "conversationId";
    let id = localStorage.getItem(key);
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(key, id);
    }
    return id;
  };

  const saveMessages = (cid: string, list: Message[]) => {
    if (typeof window === "undefined") return;
    const compact: StoredMessageRecord[] = list.map(m => ({
      id: m.id,
      content: m.content,
      role: m.role,
      timestamp: m.timestamp.toISOString(),
      traceId: m.traceId,
      primitive: m.primitive,
      channel: m.channel,
      meta: m.meta,
    }));
    localStorage.setItem(`messages:${cid}`, JSON.stringify(compact));
  };

  const loadMessages = (cid: string): Message[] | null => {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(`messages:${cid}`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return null;
      const records = parsed.filter(isStoredMessageRecord);
      if (records.length === 0) return null;
      return records.map(record => ({
        id: record.id,
        content: record.content,
        role: record.role,
        timestamp: new Date(record.timestamp),
        traceId: record.traceId,
        primitive: record.primitive,
        channel: record.channel,
        meta: Array.isArray(record.meta) ? record.meta : undefined,
      } satisfies Message));
    } catch {
      return null;
    }
  };

  const readSessionsFromStorage = (): SessionMeta[] => {
    if (typeof window === "undefined") return [];
    const raw = localStorage.getItem("sessions");
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isSessionMeta);
    } catch {
      return [];
    }
  };

  const persistSessions = (update: SessionMeta[] | ((prev: SessionMeta[]) => SessionMeta[])) => {
    setSessionsState(prev => {
      const next = typeof update === "function" ? (update as (prev: SessionMeta[]) => SessionMeta[])(prev) : update;
      if (typeof window !== "undefined") {
        localStorage.setItem("sessions", JSON.stringify(next));
      }
      return next;
    });
  };

  const switchConversation = (cid: string) => {
    if (typeof window !== "undefined") localStorage.setItem("conversationId", cid);
    setConversationId(cid);
    persistSessions(prev => (prev.some(session => session.id === cid) ? prev : [...prev, { id: cid, title: "" }]));
    const loaded = loadMessages(cid);
    if (loaded && loaded.length) {
      setMessages(loaded);
    } else {
      const fallback: Message[] = [{
        id: "welcome",
        content: "欢迎回来！请描述目标、约束、资源与风险预算，我会为你生成可审计的执行契约。",
        role: "assistant",
        timestamp: new Date(),
        primitive: "show",
        channel: "intent",
      }];
      setMessages(fallback);
      saveMessages(cid, fallback);
    }
  };

  const sendMessage = async (content: string, options?: { primitive?: Primitive; channel?: Channel; note?: string }) => {
    if (!content.trim()) return;

    const cid = getConversationId();
    setConversationId(cid);

    const userMessage: Message = {
      id: `${Date.now()}`,
      content,
      role: "user",
      timestamp: new Date(),
      primitive: options?.primitive ?? "ask",
      channel: options?.channel ?? "chat",
      meta: options?.note ? [options.note] : undefined,
    };

    setMessages(prev => {
      const next = [...prev, userMessage];
      saveMessages(cid, next);
      return next;
    });
    setIsLoading(true);

    const startTime = Date.now();

    try {
      const response = await fetch(getChatStreamEndpoint(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: content, conversationId: cid }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      const assistantId = `${Date.now()}-assistant`;
      const assistantPlaceholder: Message = {
        id: assistantId,
        content: "",
        role: "assistant",
        timestamp: new Date(),
        primitive: options?.channel === "intent" ? "show" : "learn",
        channel: options?.channel ?? "contract",
      };
      setMessages(prev => {
        const next = [...prev, assistantPlaceholder];
        saveMessages(cid, next);
        return next;
      });

      let traceId: string | undefined;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunkText = decoder.decode(value, { stream: true });
        const lines = chunkText.split(/\n\n/).map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const dataStr = line.slice(5).trim();
          try {
            const evt = JSON.parse(dataStr);
            if (evt.chunk) {
              setMessages(prev => {
                const next = prev.map(m => (
                  m.id === assistantId
                    ? {
                      ...m,
                      content: (m.content || "") + evt.chunk,
                      traceId: evt.traceId || m.traceId,
                      primitive: m.primitive ?? "show",
                    }
                    : m
                ));
                saveMessages(cid, next);
                return next;
              });
              traceId = evt.traceId || traceId;
            }
            if (evt.done) {
              const responseTime = Date.now() - startTime;
              setStats(prev => ({
                totalMessages: prev.totalMessages + 2,
                responseTime,
                activeTraces: prev.activeTraces + 1,
              }));
            }
            if (evt.error) throw new Error(evt.error);
          } catch {}
        }
      }

      if (traceId) {
        setMessages(prev => {
          const next = prev.map(item => (
            item.id === assistantId
              ? { ...item, traceId }
              : item
          ));
          saveMessages(cid, next);
          return next;
        });
      }
    } catch (error) {
      console.error("发送消息失败", error);
      const errorMessage: Message = {
        id: `${Date.now()}-error`,
        content: `抱歉，连接服务器时遇到问题。请确保后端服务在 ${getApiBaseUrl()} 上运行并提供 /api/chat 接口。错误信息: ${error instanceof Error ? error.message : "未知错误"}`,
        role: "assistant",
        timestamp: new Date(),
        primitive: "show",
        channel: "trace",
      };
      setMessages(prev => {
        const next = [...prev, errorMessage];
        saveMessages(cid, next);
        return next;
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const content = input.trim();
      if (!content) return;
      sendMessage(content, { primitive: "ask", channel: "chat" });
      setInput("");
    }
  };

  const handleIntentSubmit = async () => {
    const payload = {
      goal: intentDraft.goal.trim(),
      constraints: parseListInput(intentDraft.constraints),
      resources: parseListInput(intentDraft.resources),
      riskBudget: intentDraft.riskBudget.trim(),
      policy: {
        undo: true,
        verify: "tvo",
      },
    };

    if (!payload.goal) {
      return;
    }

    setContractSnapshot(buildContractSnapshot(intentDraft, valueEvents));

    const compiled = JSON.stringify({ type: "ICRP", intent: payload }, null, 2);
    await sendMessage(compiled, { primitive: "negotiate", channel: "intent", note: "ICRP 草案" });
  };

  const telemetryDigest = useMemo(() => {
    const success = valueEvents.filter(item => item.status === "success").length;
    const warning = valueEvents.filter(item => item.status === "warning").length;
    const anomaly = valueEvents.filter(item => item.status === "error").length;
    return { success, warning, anomaly };
  }, [valueEvents]);

  const renderContractStatus = (status: ContractStatus) => {
    switch (status) {
      case "executing":
        return <Badge variant="default" className="bg-emerald-600 text-white">执行中</Badge>;
      case "awaiting-approval":
        return <Badge variant="outline" className="border-amber-500 text-amber-600">等待批准</Badge>;
      default:
        return <Badge variant="secondary">草稿</Badge>;
    }
  };

  const ValueEventFeed = ({ compact = false }: { compact?: boolean }) => (
    <div className="flex flex-col gap-3">
      {valueEvents.map((event) => {
        const typeMeta = eventTypeMeta[event.type];
        return (
          <div
            key={event.id}
            className={`rounded-xl border px-3 py-3 shadow-sm transition-colors hover:border-primary/60 ${typeMeta.accent}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${eventStatusTone[event.status]}`}>
                    {typeMeta.label}
                  </span>
                  <span className="text-muted-foreground">{event.title}</span>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{event.summary}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {event.traceId && (
                    <Badge variant="outline" className="font-mono text-[11px]">
                      {event.traceId}
                    </Badge>
                  )}
                  <span>状态：{event.status}</span>
                  {!compact && <span>ID：{event.id}</span>}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="text-xs text-muted-foreground">{event.timeLabel}</span>
                {event.actionLabel && event.actionHref && (
                  <Link href={event.actionHref}>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                      {event.actionLabel}
                      <ArrowUpRight className="ml-1 h-3 w-3" />
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {valueEvents.length === 0 && (
        <p className="text-sm text-muted-foreground">暂无价值事件，等待编排器推送 Plan/Act/Trace 信号。</p>
      )}
    </div>
  );

  const negotiationLog = (
    <Card className="h-full">
      <CardHeader className="border-b pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-4 w-4" /> 协议对话（Human-in-the-Protocol）
        </CardTitle>
      </CardHeader>
      <CardContent className="flex h-full flex-col gap-4 p-0">
        <ScrollArea className="flex-1 px-6 py-4" ref={messageContainerRef}>
          <div className="flex flex-col gap-4">
            {messages.map(message => {
              const primitive = message.primitive ?? (message.role === "assistant" ? "show" : "ask");
              const meta = primitiveMeta[primitive];
              return (
                <div key={message.id} className="flex items-start gap-3">
                  {message.role === "assistant" ? (
                    <Avatar className="h-8 w-8">
                      <AvatarFallback>
                        <Bot className="h-4 w-4" />
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    <Avatar className="h-8 w-8">
                      <AvatarFallback>
                        <User className="h-4 w-4" />
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <div className="flex-1 rounded-xl border bg-background/80 p-3 shadow-sm">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.tone}`}>
                        {meta.icon}
                        {meta.label}
                      </span>
                      {message.channel && (
                        <Badge variant="outline" className="text-[11px] uppercase tracking-wide">
                          {message.channel}
                        </Badge>
                      )}
                      {message.meta?.map((note, index) => (
                        <Badge key={index} variant="secondary" className="text-[11px]">
                          {note}
                        </Badge>
                      ))}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {isClient ? message.timestamp.toLocaleTimeString("zh-CN", { hour12: false }) : "--:--"}
                      </span>
                    </div>
                    <Separator className="my-3" />
                    <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                      {message.content || "(等待流式响应)"}
                    </div>
                    {message.traceId && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <Route className="h-3.5 w-3.5" />
                        <span className="font-mono">{message.traceId}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {isLoading && (
              <div className="flex items-start gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback>
                    <Bot className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 rounded-xl border bg-muted/60 p-3 shadow-inner">
                  <div className="flex space-x-1">
                    <div className="h-2 w-2 animate-bounce rounded-full bg-primary" />
                    <div className="h-2 w-2 animate-bounce rounded-full bg-primary" style={{ animationDelay: "0.1s" }} />
                    <div className="h-2 w-2 animate-bounce rounded-full bg-primary" style={{ animationDelay: "0.2s" }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
        <div className="border-t bg-muted/40 px-6 py-4">
          <div className="flex flex-col gap-2">
            <Textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="使用 Ask/Show/Do 等原语继续协商……（Enter 发送，Shift+Enter 换行）"
              className="min-h-[96px]"
              disabled={isLoading}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>默认 100ms 内回显输入，超过 1 秒将提示可中断。</span>
              <Button
                onClick={() => {
                  const content = input.trim();
                  if (!content) return;
                  sendMessage(content, { primitive: "ask", channel: "chat" });
                  setInput("");
                }}
                disabled={isLoading || !input.trim()}
              >
                发送
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const sidebarContent = (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" /> 遥测概览
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">总消息数</span>
            <Badge variant="secondary">{stats.totalMessages}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">平均响应耗时</span>
            <Badge variant="outline">{stats.responseTime}ms</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">活跃 Trace</span>
            <Badge variant="default">{stats.activeTraces}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">当前会话</span>
            <Badge variant="outline" className="max-w-[180px] truncate font-mono text-[10px]">
              {conversationId}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" /> 历史剧本
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-40">
            <div className="space-y-2">
              {sessions.slice(-50).reverse().map(s => (
                <button
                  key={s.id}
                  className="w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors hover:border-primary hover:bg-primary/5"
                  onClick={() => switchConversation(s.id)}
                >
                  <div className="flex items-center justify-between gap-2 font-mono">
                    <span className="truncate">{s.id}</span>
                    <span className="text-muted-foreground">{s.title}</span>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
          <Button
            className="mt-3 w-full"
            size="sm"
            variant="secondary"
            onClick={() => {
              const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
              localStorage.setItem("conversationId", id);
              setConversationId(id);
              const welcome: Message = {
                id: "welcome",
                content: "欢迎回来！请描述目标、约束、资源与风险预算，我会为你生成可审计的执行契约。",
                role: "assistant",
                timestamp: new Date(),
                primitive: "show",
                channel: "intent",
              };
              setMessages([welcome]);
              saveMessages(id, [welcome]);
              persistSessions(prev => [...prev, { id, title: "" }]);
            }}
          >
            新建剧本
          </Button>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <>
      <Dialog open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <DialogContent className="max-w-sm gap-0 p-0 sm:max-w-sm">
          <DialogHeader className="px-4 pb-2 pt-4">
            <DialogTitle className="text-base">遥测与历史</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] px-4 pb-4">
            {sidebarContent}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <div className="flex min-h-screen flex-col bg-muted/20">
        <header className="border-b bg-background/80 backdrop-blur">
          <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-lg font-semibold">Agent 契约驾驶舱</h1>
                <p className="text-xs text-muted-foreground">
                  以“人/信息/行动”三角为骨架，捕捉意图 → 收敛契约 → Plan-Act-Trace 可追溯。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Timer className="h-3.5 w-3.5" /> 输入回声 &lt; 100ms
              </div>
              <div className="flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5" /> 主方案 + 2 个备选
              </div>
              <div className="flex items-center gap-1">
                <Undo2 className="h-3.5 w-3.5" /> 默认可撤销
              </div>
              <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
                遥测
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-6 py-6">
          <div className="grid gap-6 lg:grid-cols-[320px_1fr_320px]">
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Handshake className="h-4 w-4" /> 意图收敛（Goal + Constraint + Resource + Risk）
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">目标 Goal</label>
                    <Textarea
                      value={intentDraft.goal}
                      onChange={(event) => setIntentDraft(prev => ({ ...prev, goal: event.target.value }))}
                      placeholder="例如：在 3 天内汇总最新客户反馈并生成行动建议"
                      className="min-h-[80px]"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">约束 Constraint</label>
                    <Textarea
                      value={intentDraft.constraints}
                      onChange={(event) => setIntentDraft(prev => ({ ...prev, constraints: event.target.value }))}
                      placeholder="以换行或逗号分隔：输出需脱敏、遵循隐私政策……"
                      className="min-h-[80px]"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">资源 Resource</label>
                    <Textarea
                      value={intentDraft.resources}
                      onChange={(event) => setIntentDraft(prev => ({ ...prev, resources: event.target.value }))}
                      placeholder="可用数据源、API Token、团队成员……"
                      className="min-h-[80px]"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">风险预算 Risk</label>
                    <Textarea
                      value={intentDraft.riskBudget}
                      onChange={(event) => setIntentDraft(prev => ({ ...prev, riskBudget: event.target.value }))}
                      placeholder="容忍的误差、时间、成本、越权阈值……"
                      className="min-h-[64px]"
                    />
                  </div>
                  <Button className="w-full" onClick={handleIntentSubmit} disabled={!intentDraft.goal.trim()}>
                    生成执行草案
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    点击后生成 ICRP 草案，并推送到协商对话中以等待批准或修改。
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ListChecks className="h-4 w-4" /> 监控指标 Watch
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {(contractSnapshot?.watchers ?? []).map((item, index) => (
                    <div key={index} className="rounded-lg border bg-background/80 p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{item.label}</span>
                        <span className="font-mono text-xs text-muted-foreground">{item.value}</span>
                      </div>
                      {item.description && (
                        <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                      )}
                    </div>
                  ))}
                  {(contractSnapshot?.watchers?.length ?? 0) === 0 && (
                    <p className="text-xs text-muted-foreground">等待生成契约后自动填充置信度、验证窗口与回滚策略。</p>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-col gap-4">
              <Card>
                <CardHeader className="border-b pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Layers className="h-4 w-4" /> 契约画布（Contract Viewer）
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 p-4 text-sm">
                  {contractSnapshot ? (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center gap-3">
                        {renderContractStatus(contractSnapshot.status)}
                        <Badge variant="outline">置信度 {Math.round(contractSnapshot.confidence * 100)}%</Badge>
                        <Badge variant="secondary">生成于 {new Date(contractSnapshot.generatedAt).toLocaleTimeString("zh-CN", { hour12: false })}</Badge>
                      </div>
                      <div className="rounded-lg border bg-muted/30 p-4">
                        <h3 className="text-sm font-semibold">目标</h3>
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{contractSnapshot.goal}</p>
                        <Separator className="my-3" />
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">约束</h4>
                            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                              {contractSnapshot.constraints.length > 0 ? (
                                contractSnapshot.constraints.map((item, index) => (
                                  <li key={index}>• {item}</li>
                                ))
                              ) : (
                                <li className="text-xs">尚未提供约束</li>
                              )}
                            </ul>
                          </div>
                          <div>
                            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">资源</h4>
                            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                              {contractSnapshot.resources.length > 0 ? (
                                contractSnapshot.resources.map((item, index) => (
                                  <li key={index}>• {item}</li>
                                ))
                              ) : (
                                <li className="text-xs">等待补充资源清单</li>
                              )}
                            </ul>
                          </div>
                        </div>
                        <Separator className="my-3" />
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">风险预算</h4>
                        <p className="mt-2 text-sm text-muted-foreground">{contractSnapshot.riskBudget}</p>
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        {contractSnapshot.options.map(option => (
                          <div
                            key={option.id}
                            className={`rounded-lg border p-4 shadow-sm transition-transform hover:-translate-y-0.5 ${
                              option.recommended ? "border-primary" : "border-border"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <h3 className="text-sm font-semibold leading-tight">{option.title}</h3>
                                <p className="mt-1 text-xs text-muted-foreground">{option.tradeOff}</p>
                              </div>
                              <Badge variant={option.recommended ? "default" : "outline"}>
                                {option.recommended ? "推荐" : "备选"}
                              </Badge>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span>置信度 {Math.round(option.confidence * 100)}%</span>
                              <span>耗时 {option.duration}</span>
                              <span>成本 {option.cost}</span>
                            </div>
                            {option.fallback && (
                              <p className="mt-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">回滚：{option.fallback}</p>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="rounded-lg border bg-background/70 p-4">
                        <h3 className="text-sm font-semibold">TVO 钩子</h3>
                        <div className="mt-3 grid gap-4 md:grid-cols-3">
                          <div>
                            <h4 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              <ListChecks className="h-3.5 w-3.5" /> Test
                            </h4>
                            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                              {contractSnapshot.tvo.test.map((item, index) => (
                                <li key={index}>• {item}</li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <h4 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              <ShieldCheck className="h-3.5 w-3.5" /> Verify
                            </h4>
                            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                              {contractSnapshot.tvo.verify.map((item, index) => (
                                <li key={index}>• {item}</li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <h4 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              <Undo2 className="h-3.5 w-3.5" /> Override
                            </h4>
                            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                              {contractSnapshot.tvo.override.map((item, index) => (
                                <li key={index}>• {item}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3 text-sm text-muted-foreground">
                      <p>先在左侧描述目标与约束，系统会自动生成“主方案 + 备选方案”的契约草稿。</p>
                      <p>契约一旦生成，即可在下方协议对话中审阅、修改或授权执行。</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {negotiationLog}
            </div>

            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Gauge className="h-4 w-4" /> 遥测脉冲（Plan · Act · Trace）
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">成功</span>
                    <Badge variant="outline">{telemetryDigest.success}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">等待/警告</span>
                    <Badge variant="secondary">{telemetryDigest.warning}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">异常</span>
                    <Badge variant="destructive">{telemetryDigest.anomaly}</Badge>
                  </div>
                </CardContent>
              </Card>

              <Card className="hidden lg:block">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="h-4 w-4" /> 价值事件流
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ValueEventFeed />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <AlertTriangle className="h-4 w-4" /> 操作守则
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs text-muted-foreground">
                  <p>· 所有动作默认先在影子环境执行，可随时撤销。</p>
                  <p>· 任意越权需要在协商区说明理由，Trace 自动记录。</p>
                  <p>· 当响应超过 1 秒，将弹出可中断提示，保证注意力带宽。</p>
                </CardContent>
              </Card>

              <div className="lg:hidden">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Sparkles className="h-4 w-4" /> 价值事件流
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ValueEventFeed compact />
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}

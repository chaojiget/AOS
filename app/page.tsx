"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Send,
  Bot,
  User,
  Activity,
  Database,
  FileText,
  PanelLeft,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { getApiBaseUrl, getChatStreamEndpoint } from "@/lib/apiConfig";
import { getStoredApiToken } from "@/lib/authToken";
import Link from "next/link";

interface Message {
  id: string;
  content: string;
  role: "user" | "assistant";
  timestamp: Date;
  traceId?: string;
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
  role: Message['role'];
  timestamp: string;
  traceId?: string;
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

interface LogEntry {
  id?: string;
  timestamp: number;
  level: string;
  message: string;
  trace_id?: string;
  span_id?: string;
  attributes?: Record<string, unknown>;
}

const isStoredMessageRecord = (value: unknown): value is StoredMessageRecord => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string'
    && typeof record.content === 'string'
    && (record.role === 'user' || record.role === 'assistant')
    && typeof record.timestamp === 'string'
    && (record.traceId === undefined || typeof record.traceId === 'string')
  );
};

const isSessionMeta = (value: unknown): value is SessionMeta => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.title === 'string';
};

export default function ChatPage() {
  const [isClient, setIsClient] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string>("default");
  const [sessions, setSessionsState] = useState<SessionMeta[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [valueEvents, setValueEvents] = useState<ValueEvent[]>([]);
  const [apiToken, setApiToken] = useState<string | null>(null);

  useEffect(() => {
    setIsClient(true);
    const cid = getConversationId();
    setConversationId(cid);
    const stored = loadMessages(cid);
    if (stored && stored.length) {
      setMessages(stored);
    } else {
      const welcome = {
        id: "1",
        content: "你好！我是你的AI助手。有什么可以帮助你的吗？",
        role: "assistant",
        timestamp: new Date(),
        traceId: "trace-001"
      } as Message;
      setMessages([welcome]);
      saveMessages(cid, [welcome]);
    }
  }, []);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState<ChatStats>({
    totalMessages: 1,
    responseTime: 0,
    activeTraces: 1
  });
  const [logStreamSeed, setLogStreamSeed] = useState(0);

  const eventTypeMeta: Record<ValueEventType, { label: string; icon: JSX.Element; badgeClass: string }> = {
    progress: {
      label: "任务进度",
      icon: <Clock className="h-4 w-4 text-blue-500" />,
      badgeClass: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200",
    },
    approval: {
      label: "审批请求",
      icon: <Sparkles className="h-4 w-4 text-amber-500" />,
      badgeClass: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200",
    },
    anomaly: {
      label: "异常告警",
      icon: <AlertTriangle className="h-4 w-4 text-red-500" />,
      badgeClass: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-200",
    },
    receipt: {
      label: "结果回执",
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
      badgeClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200",
    },
  };

  const eventStatusRing: Record<ValueEventStatus, string> = {
    active: "border-blue-500",
    success: "border-emerald-500",
    warning: "border-amber-500",
    error: "border-red-500",
  };

  const mapLogToEvent = useCallback((log: LogEntry): ValueEvent => {
    const topic = typeof log.attributes?.topic === 'string' ? log.attributes.topic : undefined;
    const titleAttr = typeof log.attributes?.title === 'string' ? log.attributes.title : undefined;
    const lowerLevel = (log.level || '').toLowerCase();

    let type: ValueEventType = 'progress';
    let status: ValueEventStatus = 'active';
    let actionLabel: string | undefined;
    let actionHref: string | undefined;

    if (topic?.includes('receipt') || lowerLevel === 'success') {
      type = 'receipt';
      status = 'success';
      actionLabel = '查看结果';
      actionHref = log.trace_id ? `/telemetry?traceId=${encodeURIComponent(log.trace_id)}` : undefined;
    } else if (topic?.includes('approval') || lowerLevel === 'warn' || lowerLevel === 'warning') {
      type = 'approval';
      status = 'warning';
      actionLabel = '前往审批';
      actionHref = log.trace_id ? `/projects?traceId=${encodeURIComponent(log.trace_id)}` : '/projects';
    } else if (topic?.includes('anomaly') || lowerLevel === 'error') {
      type = 'anomaly';
      status = 'error';
      actionLabel = '查看追踪';
      actionHref = log.trace_id ? `/telemetry?traceId=${encodeURIComponent(log.trace_id)}` : undefined;
    } else {
      actionLabel = '查看详情';
      actionHref = log.trace_id ? `/telemetry?traceId=${encodeURIComponent(log.trace_id)}` : undefined;
    }

    const iso = new Date(log.timestamp).toISOString();
    const timeLabel = new Date(log.timestamp).toLocaleTimeString('zh-CN', {
      hour12: false,
    });

    return {
      id: log.id ?? `${log.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      title: titleAttr ?? topic ?? log.message.slice(0, 60) || '日志事件',
      type,
      status,
      timestamp: iso,
      timeLabel,
      summary: log.message,
      traceId: log.trace_id,
      actionLabel: typeof log.attributes?.action === 'string' ? log.attributes?.action : actionLabel,
      actionHref,
    };
  }, []);

  const upsertLogEvent = useCallback((log: LogEntry) => {
    const event = mapLogToEvent(log);
    setValueEvents(prev => {
      const filtered = prev.filter(item => item.id !== event.id);
      return [event, ...filtered].slice(0, 50);
    });
  }, [mapLogToEvent]);

  const ValueEventFeed = ({ compact = false }: { compact?: boolean }) => (
    <div className="flex flex-col gap-3">
      {valueEvents.map((event) => {
        const meta = eventTypeMeta[event.type];
        return (
          <div
            key={event.id}
            className={`rounded-lg border bg-background p-3 shadow-sm transition-colors hover:bg-muted/70 ${
              compact ? "" : ""}
            `}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${meta.badgeClass}`}>
                  {meta.icon}
                  {meta.label}
                </span>
                <span>{event.title}</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {event.timeLabel ?? new Date(event.timestamp).toLocaleTimeString('zh-CN', {
                  hour12: false,
                  timeZone: 'UTC',
                })}
              </span>
            </div>
            <div className={`mt-3 rounded-md border-l-2 bg-muted/60 p-3 text-xs leading-relaxed ${eventStatusRing[event.status]}`}>
              {event.summary}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {event.traceId && (
                <Badge variant="outline" className="font-mono">
                  {event.traceId}
                </Badge>
              )}
              <Badge variant="outline" className="capitalize">
                状态 · {event.status}
              </Badge>
              {!compact && (
                <span className="text-[11px]">
                  事件 ID：{event.id}
                </span>
              )}
              {event.actionLabel && event.actionHref && (
                <Link href={event.actionHref} className="ml-auto">
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">
                    {event.actionLabel}
                  </Button>
                </Link>
              )}
            </div>
          </div>
        );
      })}
      {valueEvents.length === 0 && (
        <p className="text-sm text-muted-foreground">
          暂无价值事件，等待 Orchestrator 推送 `task.*` 或 `anomaly.*`。
        </p>
      )}
    </div>
  );

  const messageContainerRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    if (messageContainerRef.current) {
      messageContainerRef.current.scrollTop = messageContainerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    setSessionsState(readSessionsFromStorage());
  }, []);

  useEffect(() => {
    if (!isClient) return;
    const token = getStoredApiToken();
    if (token) {
      setApiToken(token);
    }

    const handler = () => {
      const refreshed = getStoredApiToken();
      setApiToken(refreshed ?? null);
      setLogStreamSeed(prev => prev + 1);
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [isClient]);

  useEffect(() => {
    if (!isClient || !apiToken) {
      return;
    }

    let cancelled = false;
    const base = getApiBaseUrl();

    const fetchInitial = async () => {
      try {
        const res = await fetch(`${base}/api/logs?limit=30`, {
          headers: {
            Authorization: `Bearer ${apiToken}`,
          },
        });
        if (!res.ok) return;
        const json = await res.json();
        const logs = Array.isArray(json.logs) ? (json.logs as LogEntry[]) : [];
        setValueEvents(logs.map(mapLogToEvent));
      } catch (error) {
        console.error('加载初始日志失败', error);
      }
    };

    fetchInitial();

    const source = new EventSource(`${base}/api/logs/stream?token=${encodeURIComponent(apiToken)}`);

    source.onmessage = (event) => {
      try {
        const log = JSON.parse(event.data) as LogEntry;
        upsertLogEvent(log);
      } catch (error) {
        console.error('解析日志流失败', error);
      }
    };

    source.onerror = () => {
      source.close();
      if (!cancelled) {
        setTimeout(() => setLogStreamSeed(prev => prev + 1), 5000);
      }
    };

    return () => {
      cancelled = true;
      source.close();
    };
  }, [apiToken, isClient, mapLogToEvent, upsertLogEvent, logStreamSeed]);

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
    const compact = list.map(m => ({ id: m.id, content: m.content, role: m.role, timestamp: m.timestamp.toISOString(), traceId: m.traceId }));
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
        id: '1',
        content: '你好！我是你的AI助手。有什么可以帮助你的吗？',
        role: 'assistant',
        timestamp: new Date(),
        traceId: 'trace-001',
      }];
      setMessages(fallback);
      saveMessages(cid, fallback);
    }
  };

  const sendMessage = async () => {
    if (!input.trim()) return;

    const cid = getConversationId();
    setConversationId(cid);

    const userMessage: Message = {
      id: Date.now().toString(),
      content: input,
      role: "user",
      timestamp: new Date()
    };

    setMessages(prev => {
      const next = [...prev, userMessage];
      saveMessages(cid, next);
      return next;
    });
    setInput("");
    setIsLoading(true);

    const startTime = Date.now();

    try {
      // 流式调用后端
      const response = await fetch(getChatStreamEndpoint(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ message: input, conversationId: cid })
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      const assistantId = (Date.now() + 1).toString();
      const assistantPlaceholder: Message = {
        id: assistantId,
        content: '',
        role: 'assistant',
        timestamp: new Date(),
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
                const next = prev.map(m => m.id === assistantId ? { ...m, content: (m.content || "") + evt.chunk, traceId: evt.traceId || m.traceId } : m);
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
                activeTraces: prev.activeTraces + 1
              }));
            }
            if (evt.error) throw new Error(evt.error);
          } catch {}
        }
      }

    } catch (error) {
      console.error("Error sending message:", error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: `抱歉，连接服务器时遇到问题。请确保后端服务在 ${getApiBaseUrl()} 上运行并提供 /api/chat 接口。错误信息: ${error instanceof Error ? error.message : '未知错误'}`,
        role: "assistant",
        timestamp: new Date()
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const sidebarContent = (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="h-5 w-5" />
            系统监控
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">总消息数</span>
            <Badge variant="secondary">{stats.totalMessages}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">平均响应时间</span>
            <Badge variant="outline">{stats.responseTime}ms</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">活跃追踪</span>
            <Badge variant="default">{stats.activeTraces}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Database className="h-5 w-5" />
            遥测系统
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <span className="text-sm">数据库已连接</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-blue-500" />
              <span className="text-sm">追踪收集中</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-orange-500" />
              <span className="text-sm">指标活跃</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5" />
            最近追踪
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-40">
            <div className="space-y-2">
              {messages
                .filter(m => m.traceId)
                .slice(-5)
                .map(message => (
                  <div key={message.id} className="rounded bg-muted p-2 text-xs">
                    <div className="font-mono text-blue-600">{message.traceId}</div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>{message.timestamp.toLocaleTimeString()}</span>
                      <span className="font-mono">{conversationId}</span>
                    </div>
                    <div className="mt-1 truncate text-[11px] text-muted-foreground">
                      {(messages.find(msg => msg.role === 'user')?.content || '')
                        .split(/\s+/)
                        .slice(0, 5)
                        .join(' ')}
                    </div>
                  </div>
                ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5" />
            会话摘要
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">会话ID</span>
              <span className="font-mono">{conversationId}</span>
            </div>
            <div>
              <span className="text-muted-foreground">首句</span>
              <div className="mt-1 font-mono truncate">
                {(messages.find(msg => msg.role === 'user')?.content || '')
                  .split(/\s+/)
                  .slice(0, 5)
                  .join(' ')}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5" />
            历史会话
          </CardTitle>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
              localStorage.setItem("conversationId", id);
              setConversationId(id);
              const welcome = {
                id: "1",
                content: "你好！我是你的AI助手。有什么可以帮助你的吗？",
                role: "assistant",
                timestamp: new Date(),
                traceId: "trace-001"
              } as Message;
              setMessages([welcome]);
              saveMessages(id, [welcome]);
              persistSessions(prev => [...prev, { id, title: "" }]);
            }}
          >
            新会话
          </Button>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-48">
            <div className="space-y-2">
              {sessions.slice(-50).reverse().map(s => (
                <div
                  key={s.id}
                  className="cursor-pointer rounded border p-2 transition-colors hover:bg-muted"
                  onClick={() => switchConversation(s.id)}
                >
                  <div className="flex justify-between text-xs">
                    <span className="max-w-[60%] truncate font-mono">{s.id}</span>
                    <span className="max-w-[40%] truncate text-muted-foreground">{s.title}</span>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <>
      <Dialog open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <DialogContent className="max-w-sm gap-0 p-0 sm:max-w-sm">
          <DialogHeader className="px-4 pb-2 pt-4">
            <DialogTitle className="text-base">会话侧栏</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] px-4 pb-4">
            {sidebarContent}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <div className="flex min-h-screen flex-col bg-background lg:flex-row">
        <aside className="hidden h-screen w-80 flex-shrink-0 border-r bg-muted/30 lg:flex">
          <ScrollArea className="h-full w-full px-4 py-6">
            {sidebarContent}
          </ScrollArea>
        </aside>

        <div className="flex flex-1 flex-col">
          <div className="flex items-center justify-between border-b px-4 py-4 lg:px-8 lg:py-6">
            <div>
              <h1 className="flex items-center gap-2 text-xl font-semibold lg:text-2xl">
                <Bot className="h-6 w-6" />
                AOS AI 助手
              </h1>
              <p className="text-sm text-muted-foreground">
                基于 LangGraph 构建，支持 OpenTelemetry 监控
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="lg:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <PanelLeft className="h-4 w-4" />
              <span className="ml-2 text-xs">侧栏</span>
            </Button>
          </div>

          <div className="flex flex-1 flex-col lg:flex-row">
            <div className="flex flex-1 flex-col">
              <div
                ref={messageContainerRef}
                className="flex-1 overflow-y-auto px-4 py-6 lg:px-8 lg:py-8"
              >
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
                  {messages.map(message => (
                    <div
                      key={message.id}
                      className={`flex gap-3 ${
                        message.role === 'user' ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      {message.role === 'assistant' && (
                        <Avatar className="h-8 w-8">
                          <AvatarFallback>
                            <Bot className="h-4 w-4" />
                          </AvatarFallback>
                        </Avatar>
                      )}

                      <div
                        className={`max-w-full whitespace-pre-wrap break-words rounded-lg p-3 text-sm sm:max-w-[70%] ${
                          message.role === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted'
                        }`}
                      >
                        {message.content}
                        <div className="mt-2 flex items-center gap-2 text-xs opacity-70">
                          {isClient && <span>{message.timestamp.toLocaleTimeString()}</span>}
                          {message.traceId && (
                            <>
                              {isClient && <Separator orientation="vertical" className="h-3" />}
                              <span className="font-mono">{message.traceId}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {message.role === 'user' && (
                        <Avatar className="h-8 w-8">
                          <AvatarFallback>
                            <User className="h-4 w-4" />
                          </AvatarFallback>
                        </Avatar>
                      )}
                    </div>
                  ))}

                  {isLoading && (
                    <div className="flex gap-3 justify-start">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback>
                          <Bot className="h-4 w-4" />
                        </AvatarFallback>
                      </Avatar>
                      <div className="max-w-full rounded-lg bg-muted p-3 sm:max-w-[70%]">
                        <div className="flex space-x-1">
                          <div className="h-2 w-2 animate-bounce rounded-full bg-primary" />
                          <div
                            className="h-2 w-2 animate-bounce rounded-full bg-primary"
                            style={{ animationDelay: '0.1s' }}
                          />
                          <div
                            className="h-2 w-2 animate-bounce rounded-full bg-primary"
                            style={{ animationDelay: '0.2s' }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t px-4 py-4 lg:px-8 lg:py-6">
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
                  <div className="flex gap-2">
                    <Input
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="输入你的消息..."
                      className="flex-1"
                      disabled={isLoading}
                    />
                    <Button
                      onClick={sendMessage}
                      disabled={isLoading || !input.trim()}
                      size="icon"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-center text-xs text-muted-foreground">
                    按回车发送，Shift+回车换行
                  </p>
                </div>
              </div>
            </div>

            <aside className="hidden w-full max-w-sm flex-col gap-4 border-l px-6 py-6 lg:flex">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    <Sparkles className="h-4 w-4" /> 价值事件流
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    白名单主题：progress / approval / anomaly / receipt
                  </p>
                </div>
                <Badge variant="secondary">{valueEvents.length}</Badge>
              </div>
              <ValueEventFeed />
            </aside>
          </div>

          <div className="border-t px-4 py-4 lg:hidden">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <Sparkles className="h-4 w-4" /> 价值事件
            </h2>
            <ValueEventFeed compact />
          </div>
        </div>
      </div>
    </>
  );
}

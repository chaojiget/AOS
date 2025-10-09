"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Database,
  Activity,
  FileText,
  TrendingUp,
  AlertCircle,
  RefreshCw,
  Eye,
  Clock,
  Zap
} from "lucide-react";
import { telemetryEndpoint, getApiBaseUrl } from "@/lib/apiConfig";
import { getStoredApiToken, onApiTokenChange } from "@/lib/authToken";
import type { VariantProps } from "class-variance-authority";

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

interface TraceEntry {
  id: string;
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  operation_name: string;
  start_time: number;
  end_time?: number;
  duration: number;
  status: string;
  attributes?: Record<string, unknown>;
  events?: unknown;
  created_at?: number;
}

interface TraceNode {
  span: TraceEntry;
  depth: number;
  start: number;
  end: number;
  duration: number;
  children: TraceNode[];
}

interface LogEntry {
  id: string;
  timestamp: number;
  level: string;
  message: string;
  trace_id?: string;
  attributes?: Record<string, unknown>;
}

interface MetricEntry {
  id: string;
  name: string;
  value: number;
  unit?: string;
  timestamp: number;
  attributes?: Record<string, unknown>;
  created_at?: number;
}

interface TelemetryStats {
  total: {
    traces: number;
    logs: number;
    metrics: number;
  };
  recent: {
    traces: number;
    logs: number;
    metrics: number;
    errorLogs: number;
  };
  performance: {
    avgResponseTime: number;
    totalErrors: number;
    errorRate: number;
  };
  timestamp: string;
}

interface TelemetryData {
  traces: TraceEntry[];
  logs: LogEntry[];
  metrics: MetricEntry[];
  stats: TelemetryStats | null;
}

interface TraceListResponse {
  traces: TraceEntry[];
  count: number;
  timestamp: string;
}

interface LogListResponse {
  logs: LogEntry[];
  count: number;
  timestamp: string;
}

interface MetricsListResponse {
  metrics: MetricEntry[];
  count: number;
  timestamp: string;
}

interface TraceDetailResponse {
  trace: TraceEntry[];
  traceId: string;
  spans: number;
  timestamp: string;
}

type SessionMeta = { id: string; title: string };

interface SessionMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  traceId?: string;
}

interface SessionOverview {
  id: string;
  title: string;
  messageCount: number;
  firstMessageAt: Date | null;
  lastMessageAt: Date | null;
  lastMessageRole?: string;
  lastMessagePreview?: string;
  traceCount: number;
}

interface StoredSessionMessage {
  id: string;
  role: string;
  content: string;
  timestamp: string;
  traceId?: string;
}

const isSessionMeta = (value: unknown): value is SessionMeta => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.title === 'string';
};

const isStoredSessionMessage = (value: unknown): value is StoredSessionMessage => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string'
    && typeof record.role === 'string'
    && typeof record.content === 'string'
    && typeof record.timestamp === 'string'
  );
};

export default function TelemetryPage() {
  const [data, setData] = useState<TelemetryData>({
    traces: [],
    logs: [],
    metrics: [],
    stats: null
  });
  const [loading, setLoading] = useState(true);
  const [selectedTrace, setSelectedTrace] = useState<string | null>(null);
  const [traceDetail, setTraceDetail] = useState<TraceEntry[]>([]);
  const [traceLoading, setTraceLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [sessionList, setSessionList] = useState<SessionMeta[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [sessionMessages, setSessionMessages] = useState<SessionMessage[]>([]);
  const [sessionOverview, setSessionOverview] = useState<SessionOverview[]>([]);
  const [apiToken, setApiToken] = useState<string | null>(null);
  const [logStreamSeed, setLogStreamSeed] = useState(0);
  const [logLevelFilter, setLogLevelFilter] = useState<string>("");
  const [logTopicFilter, setLogTopicFilter] = useState<string>("");
  const [logBeforeCursor, setLogBeforeCursor] = useState<number | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [initializedFromQuery, setInitializedFromQuery] = useState(false);

  useEffect(() => {
    setIsClient(true);
    setLastUpdated(new Date());
  }, []);

  useEffect(() => {
    if (!isClient || initializedFromQuery) return;

    try {
      const url = new URL(window.location.href);
      const traceIdFromQuery = url.searchParams.get('traceId');
      if (traceIdFromQuery) {
        setSelectedTrace(traceIdFromQuery);
      }
    } catch (error) {
      console.warn('解析 traceId 查询参数失败', error);
    } finally {
      setInitializedFromQuery(true);
    }
  }, [initializedFromQuery, isClient]);

  useEffect(() => {
    if (!isClient) return;

    setApiToken(getStoredApiToken());

    const unsubscribe = onApiTokenChange((nextToken) => {
      const normalized = nextToken ?? null;
      setApiToken((prev) => {
        if (prev === normalized) {
          return prev;
        }
        setLogStreamSeed((seed) => seed + 1);
        return normalized;
      });
    });

    return () => {
      unsubscribe();
    };
  }, [isClient]);

  useEffect(() => {
    if (!isClient) return;
    const raw = localStorage.getItem("sessions");
    try {
      if (!raw) {
        setSessionList([]);
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        setSessionList([]);
        return;
      }
      const list = parsed.filter(isSessionMeta);
      setSessionList(list);
    } catch {
      setSessionList([]);
    }
  }, [isClient]);

  useEffect(() => {
    if (!isClient) return;

    try {
      const url = new URL(window.location.href);
      if (selectedTrace) {
        url.searchParams.set('traceId', selectedTrace);
      } else {
        url.searchParams.delete('traceId');
      }
      const next = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState(window.history.state, '', next);
    } catch (error) {
      console.warn('更新 traceId 查询参数失败', error);
    }
  }, [selectedTrace, isClient]);

  useEffect(() => {
    if (!isClient) return;
    const overviewList = sessionList.map(session => {
      let messageCount = 0;
      let firstMessageAt: Date | null = null;
      let lastMessageAt: Date | null = null;
      let lastMessageRole: string | undefined;
      let lastMessagePreview: string | undefined;
      let traceCount = 0;

      try {
        const raw = localStorage.getItem(`messages:${session.id}`);
        if (raw) {
          const parsed = JSON.parse(raw) as Array<{ id: string; role: string; content: string; timestamp: string; traceId?: string }>;
          if (Array.isArray(parsed) && parsed.length > 0) {
            messageCount = parsed.length;
            const first = parsed[0];
            const last = parsed[parsed.length - 1];
            firstMessageAt = first?.timestamp ? new Date(first.timestamp) : null;
            lastMessageAt = last?.timestamp ? new Date(last.timestamp) : null;
            lastMessageRole = last?.role;
            const previewSource = typeof last?.content === "string" ? last.content.trim() : "";
            if (previewSource) {
              lastMessagePreview = previewSource.length > 60 ? `${previewSource.slice(0, 60)}…` : previewSource;
            }
            traceCount = parsed.reduce((acc, item) => (item.traceId ? acc + 1 : acc), 0);
          }
        }
      } catch {
        // 忽略解析异常，保持默认统计
      }

      return {
        id: session.id,
        title: session.title || "",
        messageCount,
        firstMessageAt,
        lastMessageAt,
        lastMessageRole,
        lastMessagePreview,
        traceCount
      } satisfies SessionOverview;
    });

    overviewList.sort((a, b) => {
      const lastA = a.lastMessageAt ? a.lastMessageAt.getTime() : 0;
      const lastB = b.lastMessageAt ? b.lastMessageAt.getTime() : 0;
      return lastB - lastA;
    });

    setSessionOverview(overviewList);
  }, [isClient, sessionList]);

  const fetchTelemetryData = useCallback(async (options?: { append?: boolean; before?: number | null }) => {
    const append = options?.append ?? false;
    try {
      if (append) {
        setLogLoading(true);
      } else {
        setLoading(true);
      }

      const headers = apiToken ? { Authorization: `Bearer ${apiToken}` } : undefined;
      const base = getApiBaseUrl();

      const query = new URLSearchParams();
      query.set('limit', '100');
      if (logLevelFilter) query.set('level', logLevelFilter);
      if (logTopicFilter) query.set('topic', logTopicFilter);
      if (options?.before != null) {
        query.set('before', String(options.before));
      }

      const tracesPromise = fetch(`${telemetryEndpoint('traces')}?limit=50`);
      const logsPromise = apiToken
        ? fetch(`${base}/api/logs?${query.toString()}`, { headers })
        : fetch(`${telemetryEndpoint('logs')}?${query.toString()}`);
      const metricsPromise = fetch(`${telemetryEndpoint('metrics')}?limit=50`);
      const statsPromise = fetch(telemetryEndpoint('stats'));

      const [tracesRes, logsRes, metricsRes, statsRes] = await Promise.all([
        tracesPromise,
        logsPromise,
        metricsPromise,
        statsPromise
      ]);

      const [traces, logs, metrics, stats] = await Promise.all([
        tracesRes.json() as Promise<TraceListResponse>,
        logsRes.json() as Promise<LogListResponse>,
        metricsRes.json() as Promise<MetricsListResponse>,
        statsRes.json() as Promise<TelemetryStats>
      ]);

      setData(prev => {
        const newLogs = logs.logs ?? [];
        const mergedLogs = append ? [...prev.logs, ...newLogs] : newLogs;
        return {
          traces: traces.traces ?? [],
          logs: mergedLogs,
          metrics: metrics.metrics ?? [],
          stats,
        };
      });

      if (logs.logs?.length) {
        const last = logs.logs[logs.logs.length - 1];
        setLogBeforeCursor(last.timestamp);
      } else if (!append) {
        setLogBeforeCursor(null);
      }

      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to fetch telemetry data:', error);
    } finally {
      if (append) {
        setLogLoading(false);
      } else {
        setLoading(false);
      }
    }
  }, [apiToken, logLevelFilter, logTopicFilter]);

  useEffect(() => {
    fetchTelemetryData({ before: null, append: false });

    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchTelemetryData, 30000);
    return () => clearInterval(interval);
  }, [fetchTelemetryData]);

  useEffect(() => {
    const load = async () => {
      if (!selectedTrace) return;
      try {
        setTraceLoading(true);
        const res = await fetch(telemetryEndpoint(`traces/${selectedTrace}`));
        const json = (await res.json()) as TraceDetailResponse;
        setTraceDetail(json.trace ?? []);
      } catch {
        setTraceDetail([]);
      } finally {
        setTraceLoading(false);
      }
    };
    load();
  }, [selectedTrace]);

  const logMatchesFilter = useCallback((log: LogEntry) => {
    if (logLevelFilter && log.level.toLowerCase() !== logLevelFilter.toLowerCase()) {
      return false;
    }
    if (logTopicFilter) {
      const topic = typeof log.attributes?.topic === 'string' ? log.attributes.topic : '';
      if (!topic.includes(logTopicFilter)) {
        return false;
      }
    }
    return true;
  }, [logLevelFilter, logTopicFilter]);

  const applyLogFilters = useCallback(() => {
    setLogBeforeCursor(null);
    fetchTelemetryData({ append: false, before: null });
  }, [fetchTelemetryData]);

  const loadOlderLogs = useCallback(async () => {
    if (logLoading) return;
    const lastTimestamp = data.logs.length > 0
      ? data.logs[data.logs.length - 1].timestamp
      : logBeforeCursor;
    if (!lastTimestamp) return;
    await fetchTelemetryData({ append: true, before: lastTimestamp });
  }, [data.logs, logBeforeCursor, logLoading, fetchTelemetryData]);

  useEffect(() => {
    if (!isClient || !apiToken) return;

    let cancelled = false;
    const base = getApiBaseUrl();

    const source = new EventSource(`${base}/api/logs/stream?token=${encodeURIComponent(apiToken)}`);

    source.onmessage = (event) => {
      try {
        const log = JSON.parse(event.data) as LogEntry;
        if (!logMatchesFilter(log)) {
          return;
        }
        setData(prev => {
          const exists = prev.logs.some(item => item.id === log.id);
          const filtered = exists ? prev.logs.filter(item => item.id !== log.id) : prev.logs;
          return {
            ...prev,
            logs: [log, ...filtered].slice(0, 200),
          };
        });
      } catch (error) {
        console.error('解析日志流失败 (telemetry)', error);
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
  }, [apiToken, isClient, logStreamSeed, logMatchesFilter]);

  const openSession = (id: string) => {
    if (!isClient) return;
    const raw = localStorage.getItem(`messages:${id}`);
    if (!raw) {
      setSessionMessages([]);
      setSelectedSession(id);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        setSessionMessages([]);
        setSelectedSession(id);
        return;
      }
      const msgs = parsed
        .filter(isStoredSessionMessage)
        .map<SessionMessage>(m => ({
          id: m.id,
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
          timestamp: new Date(m.timestamp),
          traceId: m.traceId,
        }));
      setSessionMessages(msgs);
    } catch {
      setSessionMessages([]);
    }
    setSelectedSession(id);
  };

  const formatTimestamp = (timestamp: number) => {
    if (!isClient) return '';
    return new Date(timestamp).toLocaleString();
  };

  const formatDuration = (duration: number) => {
    if (duration < 1000) return `${duration}ms`;
    return `${(duration / 1000).toFixed(2)}s`;
  };

  const getLevelColor = (level: string): BadgeVariant => {
    switch (level.toLowerCase()) {
      case 'error':
        return 'destructive';
      case 'warn':
      case 'warning':
        return 'secondary';
      case 'info':
        return 'default';
      case 'debug':
        return 'outline';
      default:
        return 'default';
    }
  };

  const selectedSessionOverview = selectedSession
    ? sessionOverview.find(session => session.id === selectedSession)
    : undefined;

  const sessionSummary = sessionMessages.length
    ? {
        messageCount: sessionMessages.length,
        traceCount: sessionMessages.filter(message => !!message.traceId).length,
        startAt: sessionMessages[0].timestamp,
        endAt: sessionMessages[sessionMessages.length - 1].timestamp
      }
    : null;

  const traceStructure = useMemo(() => {
    if (!traceDetail.length) {
      return null;
    }

    const nodes = traceDetail.map<TraceNode>((span) => {
      const start = typeof span.start_time === 'number' ? span.start_time : Number(span.start_time) || 0;
      const explicitDuration = typeof span.duration === 'number' ? span.duration : 0;
      const derivedEnd = typeof span.end_time === 'number'
        ? span.end_time
        : start + explicitDuration;
      const end = derivedEnd > start ? derivedEnd : start + explicitDuration;

      return {
        span,
        depth: 0,
        start,
        end,
        duration: Math.max(explicitDuration || (end - start), 0),
        children: [],
      };
    });

    const nodeMap = new Map<string, TraceNode>();
    nodes.forEach(node => {
      nodeMap.set(node.span.span_id, node);
    });

    const roots: TraceNode[] = [];
    nodes.forEach(node => {
      const parentId = node.span.parent_span_id;
      if (parentId && nodeMap.has(parentId)) {
        const parent = nodeMap.get(parentId)!;
        node.depth = parent.depth + 1;
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    });

    const sortNodes = (list: TraceNode[]) => {
      list.sort((a, b) => a.start - b.start);
      list.forEach(child => sortNodes(child.children));
    };

    sortNodes(roots);

    const timelineStart = nodes.reduce((min, item) => Math.min(min, item.start), nodes[0].start);
    const timelineEnd = nodes.reduce((max, item) => Math.max(max, item.end), nodes[0].end);
    const timelineDuration = Math.max(timelineEnd - timelineStart, 1);

    return { roots, start: timelineStart, end: timelineEnd, duration: timelineDuration };
  }, [traceDetail]);

  const renderTraceNode = useCallback((node: TraceNode) => {
    if (!traceStructure) return null;

    const offsetRatio = (node.start - traceStructure.start) / traceStructure.duration;
    const widthRatio = node.duration / traceStructure.duration;
    const offsetPercent = Math.max(0, Math.min(100, offsetRatio * 100));
    const widthPercent = Math.max(0.5, Math.min(100, widthRatio * 100));

    const attributesEntries = node.span.attributes && typeof node.span.attributes === 'object'
      ? Object.entries(node.span.attributes).slice(0, 4)
      : [];

    return (
      <div
        key={node.span.span_id}
        className="rounded-md border p-3"
        style={{ marginLeft: node.depth * 16 }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <Badge variant="outline" className="text-xs">{node.span.operation_name}</Badge>
            <Badge variant={node.span.status === '0' ? 'default' : 'destructive'} className="text-[11px] uppercase tracking-wide">
              {node.span.status === '0' ? 'OK' : 'ERROR'}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground font-mono">{formatDuration(node.duration)}</span>
        </div>
        <div className="mt-2">
          <div className="relative h-3 rounded bg-muted">
            <div
              className="absolute top-0 h-3 rounded bg-primary/80"
              style={{ left: `${offsetPercent}%`, width: `${widthPercent}%` }}
            />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground font-mono">
            <span>span: {node.span.span_id}</span>
            <span>trace: {node.span.trace_id}</span>
            <span>开始: {formatTimestamp(node.start)}</span>
            <span>结束: {formatTimestamp(node.end)}</span>
          </div>
          {attributesEntries.length > 0 && (
            <div className="mt-2 text-[11px] text-muted-foreground">
              <span className="font-medium">属性：</span>
              <div className="mt-1 grid gap-1">
                {attributesEntries.map(([key, value]) => (
                  <div key={key} className="font-mono truncate">
                    {key}: {typeof value === 'string' ? value : JSON.stringify(value)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        {node.children.length > 0 && (
          <div className="mt-3 space-y-2">
            {node.children.map(child => renderTraceNode(child))}
          </div>
        )}
      </div>
    );
  }, [formatDuration, formatTimestamp, traceStructure]);

  return (
    <div className="p-6 space-y-6 bg-background min-h-screen">
      <Dialog open={!!selectedTrace} onOpenChange={(o) => { if (!o) setSelectedTrace(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>追踪详情</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {traceLoading && <div className="text-sm text-muted-foreground">加载中…</div>}
            {!traceLoading && traceDetail.length === 0 && (
              <div className="text-sm text-muted-foreground">无数据</div>
            )}
            {!traceLoading && traceStructure && (
              <div className="space-y-4">
                <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground font-mono">
                  <div>Span 数量：{traceDetail.length}</div>
                  <div>起止时间：{formatTimestamp(traceStructure.start)} → {formatTimestamp(traceStructure.end)}</div>
                  <div>总耗时：{formatDuration(traceStructure.duration)}</div>
                </div>
                <ScrollArea className="h-96">
                  <div className="space-y-2">
                    {traceStructure.roots.map(node => renderTraceNode(node))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedSession} onOpenChange={(o) => { if (!o) setSelectedSession(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="space-y-1">
              <span>会话详情</span>
              {selectedSession && (
                <span className="block font-mono text-xs text-muted-foreground">{selectedSession}</span>
              )}
            </DialogTitle>
            {selectedSessionOverview?.title && (
              <p className="text-sm text-muted-foreground">备注：{selectedSessionOverview.title}</p>
            )}
          </DialogHeader>
          {sessionSummary && (
            <div className="mb-4 grid gap-3 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground sm:grid-cols-2">
              <div>消息总数：{sessionSummary.messageCount}</div>
              <div>关联追踪：{sessionSummary.traceCount > 0 ? `${sessionSummary.traceCount} 个` : '无'}</div>
              <div>起始时间：{isClient ? sessionSummary.startAt.toLocaleString() : ''}</div>
              <div>结束时间：{isClient ? sessionSummary.endAt.toLocaleString() : ''}</div>
            </div>
          )}
          <ScrollArea className="h-96 pr-2">
            <div className="relative">
              <div className="absolute left-3 top-0 bottom-0 w-px bg-border" aria-hidden />
              <div className="space-y-4 pb-2">
                {sessionMessages.map(m => (
                  <div key={m.id} className="relative rounded-md border bg-card/40 p-3 pl-8">
                    <span
                      className={`absolute left-2.5 top-4 h-3 w-3 rounded-full ${m.role === 'user' ? 'bg-secondary' : 'bg-primary'}`}
                    />
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant={m.role === 'user' ? 'secondary' : 'default'} className="text-xs">
                        {m.role === 'user' ? '用户' : '助手'}
                      </Badge>
                      <span className="text-muted-foreground">{isClient ? m.timestamp.toLocaleString() : ''}</span>
                      {m.traceId && (
                        <>
                          <Separator orientation="vertical" className="h-3" />
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {m.traceId}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setSelectedTrace(m.traceId!)}
                          >
                            查看追踪
                          </Button>
                        </>
                      )}
                    </div>
                    <div className="mt-3 rounded-md bg-muted/50 p-3 text-sm whitespace-pre-wrap">
                      {m.content}
                    </div>
                  </div>
                ))}
                {sessionMessages.length === 0 && (
                  <div className="rounded-md border p-4 text-sm text-muted-foreground">暂无消息</div>
                )}
              </div>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6" />
            OpenTelemetry 监控仪表板
          </h1>
          <p className="text-muted-foreground">
            AOS 聊天应用实时监控与可观测性
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isClient && lastUpdated && (
            <Badge variant="outline" className="text-xs">
              <Clock className="h-3 w-3 mr-1" />
最后更新: {lastUpdated.toLocaleTimeString()}
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={fetchTelemetryData}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
      </div>

      {/* Stats Overview */}
      {data.stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <FileText className="h-4 w-4" />
                总追踪数
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.stats.total.traces}</div>
              <p className="text-xs text-muted-foreground">
过去一小时 {data.stats.recent.traces} 条
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Zap className="h-4 w-4" />
                平均响应时间
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {data.stats.performance.avgResponseTime}ms
              </div>
              <p className="text-xs text-muted-foreground">
所有请求平均值
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                错误率
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {data.stats.performance.errorRate.toFixed(1)}%
              </div>
              <p className="text-xs text-muted-foreground">
{data.stats.performance.totalErrors} 个错误
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                最近活动
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.stats.recent.logs}</div>
              <p className="text-xs text-muted-foreground">
过去一小时的日志条数
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Traces */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              最近追踪
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-80">
              <div className="space-y-2">
                {data.traces.map((trace: TraceEntry) => (
                  <div
                    key={trace.id}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 cursor-pointer"
                    onClick={() => setSelectedTrace(trace.trace_id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {trace.operation_name}
                        </Badge>
                        <Badge
                          variant={trace.status === '0' ? 'default' : 'destructive'}
                          className="text-xs"
                        >
                          {trace.status === '0' ? 'OK' : 'ERROR'}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground font-mono mt-1">
                        {trace.trace_id}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatTimestamp(trace.start_time)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium">
                        {formatDuration(trace.duration)}
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setSelectedTrace(trace.trace_id)}>
                        <Eye className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Recent Logs */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              最近日志
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Input
                placeholder="Topic 包含..."
                value={logTopicFilter}
                onChange={(event) => setLogTopicFilter(event.target.value)}
                className="w-40"
              />
              <select
                value={logLevelFilter}
                onChange={(event) => setLogLevelFilter(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                <option value="">全部级别</option>
                <option value="error">Error</option>
                <option value="warn">Warn</option>
                <option value="info">Info</option>
                <option value="debug">Debug</option>
              </select>
              <Button size="sm" onClick={applyLogFilters} disabled={loading || logLoading}>
                <RefreshCw className="mr-1 h-3 w-3" /> 应用
              </Button>
              <Button size="sm" variant="outline" onClick={loadOlderLogs} disabled={logLoading || data.logs.length === 0}>
                {logLoading ? '加载中...' : '加载更多'}
              </Button>
            </div>
            <ScrollArea className="h-80">
              <div className="space-y-2">
                {data.logs.map(log => (
                  <div key={log.id} className="p-3 border rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <Badge variant={getLevelColor(log.level)} className="text-xs">
                        {log.level.toUpperCase()}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatTimestamp(log.timestamp)}
                      </span>
                    </div>
                    <div className="text-sm">{log.message}</div>
                    {log.trace_id && (
                      <div className="text-xs text-muted-foreground font-mono mt-1">
                        追踪: {log.trace_id}
                      </div>
                    )}
                    {typeof log.attributes?.topic === 'string' && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Topic: {String(log.attributes.topic)}
                      </div>
                    )}
                  </div>
                ))}
                {data.logs.length === 0 && (
                  <p className="text-xs text-muted-foreground">暂无日志记录</p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            会话监控
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            汇总本地保存的会话，可快速打开并查看完整对话流程。
          </p>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-72">
            <div className="space-y-3">
              {!isClient && (
                <div className="text-sm text-muted-foreground">正在加载会话信息…</div>
              )}
              {isClient && sessionOverview.length === 0 && (
                <div className="text-sm text-muted-foreground">暂无会话</div>
              )}
              {sessionOverview.map(session => {
                const title = session.title.trim() || session.lastMessagePreview || "未命名会话";
                return (
                  <div
                    key={session.id}
                    className="group cursor-pointer rounded-lg border p-3 transition-colors hover:bg-muted/60"
                    onClick={() => openSession(session.id)}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="font-mono text-sm">{session.id}</div>
                        <div className="text-xs text-muted-foreground">{title}</div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={event => {
                          event.stopPropagation();
                          openSession(session.id);
                        }}
                      >
                        查看全流程
                      </Button>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                      <div>消息数：{session.messageCount}</div>
                      <div>关联追踪：{session.traceCount > 0 ? `${session.traceCount} 个` : '无'}</div>
                      <div>起始：{session.firstMessageAt ? session.firstMessageAt.toLocaleString() : '—'}</div>
                      <div>最近：{session.lastMessageAt ? session.lastMessageAt.toLocaleString() : '—'}</div>
                    </div>
                    {session.lastMessagePreview && (
                      <div className="mt-3 rounded bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                        最近内容：{session.lastMessagePreview}
                      </div>
                    )}
                    {session.lastMessageRole && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant={session.lastMessageRole === 'user' ? 'secondary' : 'default'} className="text-xs">
                          最后发言：{session.lastMessageRole === 'user' ? '用户' : '助手'}
                        </Badge>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Metrics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            最近指标
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-60">
            <div className="space-y-3">
              {data.metrics.map(metric => (
                <div key={metric.id} className="flex items-center justify-between p-2 border rounded">
                  <div>
                    <div className="font-medium text-sm">{metric.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatTimestamp(metric.timestamp)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm">
                      {metric.value} {metric.unit}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { telemetryEndpoint } from "@/lib/apiConfig";

interface TelemetryData {
  traces: any[];
  logs: any[];
  metrics: any[];
  stats: any;
}

interface LogEntry {
  id: string;
  timestamp: number;
  level: string;
  message: string;
  trace_id?: string;
  attributes?: string;
}

interface TraceEntry {
  id: string;
  trace_id: string;
  span_id: string;
  operation_name: string;
  start_time: number;
  duration: number;
  status: string;
}

export default function TelemetryPage() {
  const [data, setData] = useState<TelemetryData>({
    traces: [],
    logs: [],
    metrics: [],
    stats: null
  });
  const [loading, setLoading] = useState(true);
  const [selectedTrace, setSelectedTrace] = useState<string | null>(null);
  const [traceDetail, setTraceDetail] = useState<any[]>([]);
  const [traceLoading, setTraceLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [sessionList, setSessionList] = useState<Array<{ id: string; title: string }>>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [sessionMessages, setSessionMessages] = useState<Array<{ id: string; role: string; content: string; timestamp: Date; traceId?: string }>>([]);

  useEffect(() => {
    setIsClient(true);
    setLastUpdated(new Date());
  }, []);

  useEffect(() => {
    if (!isClient) return;
    const raw = localStorage.getItem("sessions");
    try {
      const list = raw ? (JSON.parse(raw) as Array<{ id: string; title: string }>) : [];
      setSessionList(list);
    } catch {
      setSessionList([]);
    }
  }, [isClient]);

  const fetchTelemetryData = async () => {
    try {
      setLoading(true);

      const [tracesRes, logsRes, metricsRes, statsRes] = await Promise.all([
        fetch(`${telemetryEndpoint('traces')}?limit=50`),
        fetch(`${telemetryEndpoint('logs')}?limit=100`),
        fetch(`${telemetryEndpoint('metrics')}?limit=50`),
        fetch(telemetryEndpoint('stats'))
      ]);

      const [traces, logs, metrics, stats] = await Promise.all([
        tracesRes.json(),
        logsRes.json(),
        metricsRes.json(),
        statsRes.json()
      ]);

      setData({
        traces: traces.traces || [],
        logs: logs.logs || [],
        metrics: metrics.metrics || [],
        stats: stats
      });

      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to fetch telemetry data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTelemetryData();

    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchTelemetryData, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!selectedTrace) return;
      try {
        setTraceLoading(true);
        const res = await fetch(telemetryEndpoint(`traces/${selectedTrace}`));
        const json = await res.json();
        setTraceDetail(json.trace || []);
      } catch {
        setTraceDetail([]);
      } finally {
        setTraceLoading(false);
      }
    };
    load();
  }, [selectedTrace]);

  const openSession = (id: string) => {
    if (!isClient) return;
    const raw = localStorage.getItem(`messages:${id}`);
    if (!raw) {
      setSessionMessages([]);
      setSelectedSession(id);
      return;
    }
    try {
      const arr = JSON.parse(raw) as Array<{ id: string; role: string; content: string; timestamp: string; traceId?: string }>;
      const msgs = arr.map(m => ({ ...m, timestamp: new Date(m.timestamp) }));
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

  const getLevelColor = (level: string) => {
    switch (level.toLowerCase()) {
      case 'error': return 'destructive';
      case 'warn': case 'warning': return 'secondary';
      case 'info': return 'default';
      case 'debug': return 'outline';
      default: return 'default';
    }
  };

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
            {!traceLoading && traceDetail.length > 0 && (
              <ScrollArea className="h-96">
                <div className="space-y-2">
                  {traceDetail.map((span: any) => (
                    <div key={span.span_id} className="p-3 border rounded">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{span.operation_name}</Badge>
                        <Badge variant={span.status === '0' ? 'default' : 'destructive'} className="text-xs">{span.status === '0' ? 'OK' : 'ERROR'}</Badge>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground font-mono">
                        <div>span: {span.span_id}</div>
                        <div>trace: {span.trace_id}</div>
                        <div>开始: {formatTimestamp(span.start_time)}</div>
                        <div>耗时: {formatDuration(span.duration)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedSession} onOpenChange={(o) => { if (!o) setSelectedSession(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>会话详情 {selectedSession && <span className="font-mono text-xs text-muted-foreground">{selectedSession}</span>}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-96">
            <div className="space-y-3">
              {sessionMessages.map(m => (
                <div key={m.id} className="p-3 rounded border">
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant={m.role === 'user' ? 'secondary' : 'default'} className="text-xs">{m.role}</Badge>
                    <span className="text-muted-foreground">{isClient ? m.timestamp.toLocaleString() : ''}</span>
                    {m.traceId && (
                      <>
                        <Separator orientation="vertical" className="h-3" />
                        <span className="font-mono">{m.traceId}</span>
                      </>
                    )}
                  </div>
                  <div className="mt-2 text-sm whitespace-pre-wrap">{m.content}</div>
                </div>
              ))}
              {sessionMessages.length === 0 && (
                <div className="text-sm text-muted-foreground">暂无消息</div>
              )}
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
            <ScrollArea className="h-80">
              <div className="space-y-2">
                {data.logs.map((log: LogEntry) => (
                  <div key={log.id} className="p-3 border rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <Badge variant={getLevelColor(log.level) as any} className="text-xs">
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
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            会话记录
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-60">
            <div className="space-y-2">
              {isClient && sessionList.length === 0 && (
                <div className="text-sm text-muted-foreground">暂无会话</div>
              )}
              {sessionList.slice(-100).reverse().map(s => (
                <div key={s.id} className="p-2 border rounded hover:bg-muted cursor-pointer" onClick={() => openSession(s.id)}>
                  <div className="flex justify-between text-xs">
                    <span className="font-mono truncate max-w-[60%]">{s.id}</span>
                    <span className="text-muted-foreground truncate max-w-[40%]">{s.title}</span>
                  </div>
                </div>
              ))}
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
              {data.metrics.map((metric: any) => (
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
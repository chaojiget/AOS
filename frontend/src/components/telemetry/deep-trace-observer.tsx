"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  Minus,
  Plus,
  Search,
  Target,
  X,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { TelemetryLog } from "@/lib/telemetry";
import { humanTime, shortId } from "@/lib/telemetry";
import {
  buildDeepTraceStore,
  buildVisibleSpanIds,
  computeCriticalPath,
  type DeepTraceSpan,
  type DeepTraceStore,
} from "@/lib/deep-trace";
import { cn } from "@/lib/utils";

const LEFT_COL_PX = 340;
const ROW_HEIGHT = 38;
const MIN_BAR_PX = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms)) return "-";
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 2)}s`;
  return `${Math.round(ms)}ms`;
}

function niceStepMs(targetMs: number): number {
  if (!Number.isFinite(targetMs) || targetMs <= 0) return 1000;
  const power = Math.pow(10, Math.floor(Math.log10(targetMs)));
  const candidates = [1, 2, 5, 10].map((n) => n * power);
  for (const c of candidates) {
    if (c >= targetMs) return c;
  }
  return 10 * power;
}

function formatTickLabel(ms: number): string {
  if (ms >= 60_000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s`;
  return `${Math.round(ms)}ms`;
}

function kindColor(kind: DeepTraceSpan["kind"], status: DeepTraceSpan["status"]): string {
  const base =
    kind === "LLM"
      ? "bg-emerald-500/20 border-emerald-400/40"
      : kind === "RETRIEVAL"
        ? "bg-sky-500/20 border-sky-400/40"
        : kind === "TOOL"
          ? "bg-fuchsia-500/20 border-fuchsia-400/40"
          : "bg-white/10 border-white/15";

  if (status === "error") return `${base} ring-1 ring-red-400/40`;
  return base;
}

function useRafState<T>(initial: T): [T, (next: T) => void] {
  const [state, setState] = React.useState(initial);
  const frame = React.useRef<number | null>(null);
  const pending = React.useRef<T>(initial);

  const set = React.useCallback((next: T) => {
    pending.current = next;
    if (frame.current != null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setState(pending.current);
    });
  }, []);

  React.useEffect(
    () => () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return [state, set];
}

function TimeRuler({
  store,
  pxPerMs,
  scrollLeft,
  viewportWidth,
}: {
  store: DeepTraceStore;
  pxPerMs: number;
  scrollLeft: number;
  viewportWidth: number;
}) {
  const durationMs = Math.max(store.meta.totalDurationMs, 1);
  const visibleWidth = Math.max(0, viewportWidth - LEFT_COL_PX);
  const startMs = scrollLeft / pxPerMs;
  const endMs = (scrollLeft + visibleWidth) / pxPerMs;
  const stepMs = niceStepMs(120 / pxPerMs);

  const first = Math.max(0, Math.floor(startMs / stepMs) * stepMs);
  const ticks: number[] = [];
  for (let t = first; t <= Math.min(endMs + stepMs, durationMs); t += stepMs) ticks.push(t);

  return (
    <div className="flex h-10 items-center border-b border-white/10 bg-black/20">
      <div
        className="sticky left-0 z-10 flex h-10 shrink-0 items-center gap-2 border-r border-white/10 bg-black/30 px-3 text-xs text-zinc-300"
        style={{ width: LEFT_COL_PX }}
      >
        <span className="font-medium">{shortId(store.meta.traceId, 28)}</span>
        <span className="text-zinc-500">·</span>
        <span className="text-zinc-400">{formatDurationMs(durationMs)}</span>
      </div>

      <div className="relative h-10 flex-1 overflow-hidden">
        <div
          className="relative h-10"
          style={{
            width: Math.max(600, durationMs * pxPerMs + 140),
            transform: `translateX(${-scrollLeft}px)`,
          }}
        >
          {ticks.map((t) => {
            const x = t * pxPerMs;
            return (
              <div key={t} className="absolute top-0 h-full" style={{ left: x }}>
                <div className="h-full w-px bg-white/10" />
                <div className="absolute left-1 top-2 text-[10px] text-zinc-400">
                  {formatTickLabel(t)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function IndentGuides({ depth }: { depth: number }) {
  if (depth <= 0) return null;
  return (
    <div className="flex items-center">
      {Array.from({ length: depth }).map((_, i) => (
        <span key={i} className="h-6 w-4 border-l border-white/10" />
      ))}
    </div>
  );
}

function SpanRow({
  span,
  pxPerMs,
  timelineWidth,
  collapsed,
  onToggleCollapse,
  selected,
  onSelect,
  criticalPath,
  criticalOnly,
}: {
  span: DeepTraceSpan;
  pxPerMs: number;
  timelineWidth: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  selected: boolean;
  onSelect: () => void;
  criticalPath: Set<string>;
  criticalOnly: boolean;
}) {
  const hasChildren = span.children.length > 0;
  const isCritical = criticalPath.has(span.id);
  const dim = criticalOnly && !isCritical;

  const left = span.startOffsetMs * pxPerMs;
  const width = Math.max(span.durationMs * pxPerMs, MIN_BAR_PX);
  const barLabel = width > 120 ? `${span.name} · ${formatDurationMs(span.durationMs)}` : width > 60 ? formatDurationMs(span.durationMs) : "";

  return (
    <div
      className={cn(
        "flex h-[38px] border-b border-white/5 text-sm",
        selected ? "bg-white/10" : "hover:bg-white/5",
      )}
      onClick={onSelect}
      role="button"
      tabIndex={0}
    >
      <div
        className={cn(
          "sticky left-0 z-10 flex h-[38px] shrink-0 items-center gap-2 border-r border-white/10 bg-black/30 px-2",
          selected ? "bg-white/10" : "bg-black/30",
        )}
        style={{ width: LEFT_COL_PX }}
      >
        <IndentGuides depth={span.depth} />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggleCollapse();
          }}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-white/10",
            !hasChildren && "opacity-40 hover:bg-transparent",
          )}
          aria-label={hasChildren ? "toggle" : "leaf"}
        >
          {hasChildren ? (
            collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-medium text-zinc-100">{span.name}</div>
            {span.totalErrorCount > 0 ? (
              <span className="inline-flex h-2 w-2 rounded-full bg-red-400/80" />
            ) : null}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-400">
            <span>{span.kind}</span>
            <span className="text-zinc-600">·</span>
            <span>{formatDurationMs(span.durationMs)}</span>
            <span className="text-zinc-600">·</span>
            <span>
              {span.totalLogCount}
              {span.totalErrorCount ? ` (!${span.totalErrorCount})` : ""}
            </span>
          </div>
        </div>
      </div>

      <div className="relative h-[38px] flex-1">
        <div className="relative h-[38px]" style={{ width: timelineWidth }}>
          <div
            className={cn(
              "absolute top-1 h-6 rounded border px-1 text-[11px] leading-6 text-zinc-100 transition-colors",
              kindColor(span.kind, span.status),
              dim && "opacity-30",
              isCritical && "ring-1 ring-amber-300/50",
              selected && "ring-2 ring-white/30",
            )}
            style={{ left, width }}
          >
            <span className="block truncate">{barLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Inspector({
  store,
  spanId,
  onClose,
}: {
  store: DeepTraceStore;
  spanId: string;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const span = store.spans[spanId];
  const logObjects = span.logIds.map((id) => store.logsById[id]).filter(Boolean);
  const sampleAttributes = logObjects.find((log) => log.attributes != null)?.attributes ?? null;

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-label={t("common.close")}
      />
      <div className="absolute right-0 top-0 flex h-full w-full flex-col border-l border-white/10 bg-zinc-950/70 backdrop-blur-xl sm:w-[440px]">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={span.status === "error" ? "error" : "default"}>{span.status}</Badge>
              <Badge variant="info">{span.kind}</Badge>
              <div className="text-xs text-zinc-400">{formatDurationMs(span.durationMs)}</div>
            </div>
            <div className="mt-2 break-words text-sm font-semibold text-zinc-100">{span.name}</div>
            <div className="mt-1 text-xs text-zinc-400">
              id: <span className="break-all text-zinc-200">{span.id}</span>
            </div>
            {span.parentId ? (
              <div className="mt-1 text-xs text-zinc-400">
                parent: <span className="break-all text-zinc-200">{span.parentId}</span>
              </div>
            ) : null}
          </div>
          <Button type="button" variant="ghost" className="h-9 px-2" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-auto px-4 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-zinc-400">{t("deepTrace.logs")}</div>
              <div className="mt-1 text-sm font-medium text-zinc-100">{span.totalLogCount}</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-zinc-400">{t("deepTrace.errors")}</div>
              <div className="mt-1 text-sm font-medium text-zinc-100">{span.totalErrorCount}</div>
            </div>
          </div>

          <div className="mt-4">
            <div className="text-xs font-medium text-zinc-300">{t("deepTrace.recentLogs")}</div>
            <div className="mt-2 flex flex-col gap-2">
              {logObjects.slice(-40).map((log) => (
                <div key={log.id} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={log.level.toUpperCase() === "ERROR" ? "error" : log.level.toUpperCase() === "INFO" ? "info" : "default"}>
                      {log.level}
                    </Badge>
                    <div className="text-xs text-zinc-400">{humanTime(log.timestamp, lang)}</div>
                  </div>
                  <div className="mt-1 break-words text-xs text-zinc-200">{log.message}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <div className="text-xs font-medium text-zinc-300">{t("deepTrace.attributes")}</div>
            <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-3">
              <pre className="whitespace-pre-wrap break-words text-[11px] text-zinc-200">
                {JSON.stringify(sampleAttributes, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DeepTraceObserver({ logs }: { logs: TelemetryLog[] }) {
  const { t } = useI18n();
  const store = React.useMemo(() => buildDeepTraceStore(logs), [logs]);

  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());
  const [selectedSpanId, setSelectedSpanId] = React.useState<string | null>(null);
  const [criticalOnly, setCriticalOnly] = React.useState(false);
  const criticalPath = React.useMemo(() => computeCriticalPath(store), [store]);

  const [search, setSearch] = React.useState("");
  const [matchIndex, setMatchIndex] = React.useState(0);

  const [pxPerMs, setPxPerMs] = React.useState(0.12);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  const [scrollLeft, setScrollLeft] = useRafState(0);
  const [viewportWidth, setViewportWidth] = React.useState(0);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const update = () => setViewportWidth(el.clientWidth);
    update();

    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const visibleSpanIds = React.useMemo(() => buildVisibleSpanIds(store, collapsed), [store, collapsed]);
  const indexBySpanId = React.useMemo(() => {
    const map = new Map<string, number>();
    visibleSpanIds.forEach((id, idx) => map.set(id, idx));
    return map;
  }, [visibleSpanIds]);

  const matchingSpanIds = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return visibleSpanIds.filter((id) => {
      const span = store.spans[id];
      return span.name.toLowerCase().includes(q) || span.id.toLowerCase().includes(q) || (q === "error" && span.totalErrorCount > 0);
    });
  }, [search, store.spans, visibleSpanIds]);

  React.useEffect(() => {
    setMatchIndex(0);
  }, [search]);

  const rowVirtualizer = useVirtualizer({
    count: visibleSpanIds.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const durationMs = Math.max(store.meta.totalDurationMs, 1);
  const timelineWidth = Math.max(700, durationMs * pxPerMs + 160);

  const toggleCollapse = (spanId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  };

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => {
    const next = new Set<string>();
    for (const span of Object.values(store.spans)) if (span.children.length) next.add(span.id);
    setCollapsed(next);
  };

  const scrollToSpan = React.useCallback((spanId: string) => {
    const idx = indexBySpanId.get(spanId);
    if (idx == null) return;
    rowVirtualizer.scrollToIndex(idx, { align: "center" });
  }, [indexBySpanId, rowVirtualizer]);

  const gotoNextMatch = React.useCallback(() => {
    if (matchingSpanIds.length === 0) return;
    const nextIndex = (matchIndex + 1) % matchingSpanIds.length;
    setMatchIndex(nextIndex);
    scrollToSpan(matchingSpanIds[nextIndex]);
  }, [matchIndex, matchingSpanIds, scrollToSpan]);

  const gotoPrevMatch = React.useCallback(() => {
    if (matchingSpanIds.length === 0) return;
    const nextIndex = (matchIndex - 1 + matchingSpanIds.length) % matchingSpanIds.length;
    setMatchIndex(nextIndex);
    scrollToSpan(matchingSpanIds[nextIndex]);
  }, [matchIndex, matchingSpanIds, scrollToSpan]);

  const gotoNextMatchRef = React.useRef(gotoNextMatch);
  React.useEffect(() => {
    gotoNextMatchRef.current = gotoNextMatch;
  }, [gotoNextMatch]);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "Enter" && document.activeElement === searchRef.current) {
        e.preventDefault();
        gotoNextMatchRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey) return;
    e.preventDefault();

    const el = scrollRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const anchorX = clamp(e.clientX - rect.left - LEFT_COL_PX, 0, rect.width);
    const timeAtPointer = (el.scrollLeft + anchorX) / pxPerMs;

    const factor = Math.exp(-e.deltaY * 0.001);
    const next = clamp(pxPerMs * factor, 0.02, 1.2);

    setPxPerMs(next);

    requestAnimationFrame(() => {
      const nextScrollLeft = timeAtPointer * next - anchorX;
      el.scrollLeft = Math.max(0, nextScrollLeft);
      setScrollLeft(el.scrollLeft);
    });
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollLeft(el.scrollLeft);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-sm">{t("deepTrace.title")}</CardTitle>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-300">
              <Badge variant="default">{t("deepTrace.spans")}: {Object.keys(store.spans).length}</Badge>
              <Badge variant="info">{t("deepTrace.logs")}: {logs.length}</Badge>
              <Badge variant={logs.some((l) => l.level.toUpperCase() === "ERROR") ? "error" : "default"}>
                {t("deepTrace.errors")}: {logs.filter((l) => l.level.toUpperCase() === "ERROR").length}
              </Badge>
              <Badge variant="default">{t("deepTrace.duration")}: {formatDurationMs(durationMs)}</Badge>
              <Badge variant="default">{t("deepTrace.zoom")}: {(pxPerMs * 1000).toFixed(pxPerMs >= 0.2 ? 0 : 1)}px/s</Badge>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-[260px]">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-zinc-500" />
              <Input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("deepTrace.searchPlaceholder")}
                className="pl-9"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" className="h-10 px-2" onClick={gotoPrevMatch} disabled={!matchingSpanIds.length}>
                <ChevronRight className="h-4 w-4 rotate-180" />
              </Button>
              <Button type="button" variant="ghost" className="h-10 px-2" onClick={gotoNextMatch} disabled={!matchingSpanIds.length}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant={criticalOnly ? "secondary" : "ghost"}
                className="h-10 px-2"
                onClick={() => setCriticalOnly((v) => !v)}
              >
                <Target className="mr-2 h-4 w-4" />
                {t("deepTrace.critical")}
              </Button>
              <Button type="button" variant="ghost" className="h-10 px-2" onClick={expandAll}>
                <Plus className="mr-2 h-4 w-4" />
                {t("common.expandAll")}
              </Button>
              <Button type="button" variant="ghost" className="h-10 px-2" onClick={collapseAll}>
                <Minus className="mr-2 h-4 w-4" />
                {t("common.collapseAll")}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="relative border-t border-white/10">
            <TimeRuler
              store={store}
              pxPerMs={pxPerMs}
              scrollLeft={scrollLeft}
              viewportWidth={viewportWidth}
            />
            <div
              ref={scrollRef}
              className="relative h-[70vh] overflow-auto"
              onScroll={onScroll}
              onWheel={onWheel}
            >
              <div style={{ width: LEFT_COL_PX + timelineWidth }}>
                <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const spanId = visibleSpanIds[virtualRow.index];
                    const span = store.spans[spanId];
                    const isCollapsed = collapsed.has(spanId);
                    const selected = selectedSpanId === spanId;
                    const isMatch = matchingSpanIds[matchIndex] === spanId;

                    return (
                      <div
                        key={spanId}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: virtualRow.size,
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        <div className={cn(isMatch && "outline outline-1 outline-amber-300/60")}>
                          <SpanRow
                            span={span}
                            pxPerMs={pxPerMs}
                            timelineWidth={timelineWidth}
                            collapsed={isCollapsed}
                            onToggleCollapse={() => toggleCollapse(spanId)}
                            selected={selected}
                            onSelect={() => setSelectedSpanId(spanId)}
                            criticalPath={criticalPath}
                            criticalOnly={criticalOnly}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {store.orphanLogs.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("traceChain.orphanLogs")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {store.orphanLogs.slice(0, 80).map((log) => (
              <div key={log.id} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm">
                <div className="text-xs text-zinc-400">{log.logger_name ?? "-"}</div>
                <div className="mt-1 break-words text-zinc-100">{log.message}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {selectedSpanId ? (
        <Inspector store={store} spanId={selectedSpanId} onClose={() => setSelectedSpanId(null)} />
      ) : null}
    </div>
  );
}

"use client";

import * as React from "react";
import { ChevronRight, Minus, Plus, Search, Target } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { TelemetryLog } from "@/lib/telemetry";
import {
  buildDeepTraceStore,
  buildVisibleSpanIds,
  computeCriticalPath,
} from "@/lib/deep-trace";

import {
  DEFAULT_PX_PER_MS,
  LEFT_COL_PX,
  MAX_PX_PER_MS,
  MIN_PX_PER_MS,
  ROW_HEIGHT,
} from "./constants";
import { clamp, formatDurationMs } from "./format";
import { Inspector } from "./inspector";
import { SpanTimelineRow, SpanTreeRow } from "./span-row";
import { TimeRuler } from "./time-ruler";
import { useCollapsedSpans } from "./use-collapsed-spans";
import { useDeepTraceSearch } from "./use-deep-trace-search";
import { useElementClientWidth } from "./use-element-width";
import { useRafState } from "./use-raf-state";
import { useWheelZoom } from "./use-wheel-zoom";

function useSpanIdIndexMap(spanIds: string[]) {
  return React.useMemo(() => {
    const map = new Map<string, number>();
    spanIds.forEach((id, idx) => map.set(id, idx));
    return map;
  }, [spanIds]);
}

export function DeepTraceObserver({ logs }: { logs: TelemetryLog[] }) {
  const { t } = useI18n();
  const store = React.useMemo(() => buildDeepTraceStore(logs), [logs]);

  const [selectedSpanId, setSelectedSpanId] = React.useState<string | null>(null);
  const [criticalOnly, setCriticalOnly] = React.useState(false);
  const criticalPath = React.useMemo(() => computeCriticalPath(store), [store]);

  const { collapsed, toggleCollapse, expandAll, collapseAll } = useCollapsedSpans(store);
  const visibleSpanIds = React.useMemo(
    () => buildVisibleSpanIds(store, collapsed),
    [store, collapsed],
  );
  const indexBySpanId = useSpanIdIndexMap(visibleSpanIds);

  React.useEffect(() => {
    if (selectedSpanId && !store.spans[selectedSpanId]) setSelectedSpanId(null);
  }, [selectedSpanId, store.spans]);

  const leftScrollRef = React.useRef<HTMLDivElement>(null);
  const rightScrollRef = React.useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useRafState(0);
  const timelineViewportWidth = useElementClientWidth(rightScrollRef);
  const viewportWidth = timelineViewportWidth + LEFT_COL_PX;

  const rowVirtualizer = useVirtualizer({
    count: visibleSpanIds.length,
    getScrollElement: () => rightScrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const durationMs = Math.max(store.meta.totalDurationMs, 1);
  const [pxPerMs, setPxPerMs] = React.useState(DEFAULT_PX_PER_MS);
  const timelineWidth = Math.max(timelineViewportWidth, durationMs * pxPerMs + 1);

  const didAutoFit = React.useRef<string | null>(null);

  const computeFitPxPerMs = React.useCallback(() => {
    if (!timelineViewportWidth) return;
    return timelineViewportWidth / durationMs;
  }, [durationMs, timelineViewportWidth]);

  const autoFitIfNeeded = React.useCallback(() => {
    const fit = computeFitPxPerMs();
    if (fit == null) return;
    setPxPerMs((current) => clamp(Math.min(current, fit), MIN_PX_PER_MS, MAX_PX_PER_MS));
  }, [computeFitPxPerMs]);

  const fitToViewport = React.useCallback(() => {
    const fit = computeFitPxPerMs();
    if (fit == null) return;
    setPxPerMs(clamp(fit, MIN_PX_PER_MS, MAX_PX_PER_MS));
  }, [computeFitPxPerMs]);

  React.useEffect(() => {
    didAutoFit.current = null;
    setPxPerMs(DEFAULT_PX_PER_MS);
  }, [store.meta.traceId]);

  React.useEffect(() => {
    if (!timelineViewportWidth) return;
    if (didAutoFit.current === store.meta.traceId) return;
    didAutoFit.current = store.meta.traceId;
    autoFitIfNeeded();
  }, [autoFitIfNeeded, store.meta.traceId, timelineViewportWidth]);

  const scrollToSpan = React.useCallback(
    (spanId: string) => {
      const idx = indexBySpanId.get(spanId);
      if (idx == null) return;
      rowVirtualizer.scrollToIndex(idx, { align: "center" });
    },
    [indexBySpanId, rowVirtualizer],
  );

  const {
    query: search,
    setQuery: setSearch,
    inputRef: searchRef,
    matchingSpanIds,
    matchIndex,
    gotoNextMatch,
    gotoPrevMatch,
  } = useDeepTraceSearch({
    visibleSpanIds,
    spans: store.spans,
    onJumpToSpan: scrollToSpan,
  });

  const onWheel = useWheelZoom({
    scrollRef: rightScrollRef,
    pxPerMs,
    setPxPerMs,
    onScrollLeftChange: setScrollLeft,
  });

  const syncRef = React.useRef<"left" | "right" | null>(null);

  const onLeftScroll = () => {
    const left = leftScrollRef.current;
    const right = rightScrollRef.current;
    if (!left || !right) return;
    if (syncRef.current === "right") return;
    syncRef.current = "left";
    right.scrollTop = left.scrollTop;
    requestAnimationFrame(() => {
      if (syncRef.current === "left") syncRef.current = null;
    });
  };

  const onRightScroll = () => {
    const left = leftScrollRef.current;
    const right = rightScrollRef.current;
    if (!right) return;
    setScrollLeft(right.scrollLeft);
    if (!left) return;
    if (syncRef.current === "left") return;
    syncRef.current = "right";
    left.scrollTop = right.scrollTop;
    requestAnimationFrame(() => {
      if (syncRef.current === "right") syncRef.current = null;
    });
  };

  const errorCount = React.useMemo(
    () => logs.reduce((acc, l) => acc + (l.level.toUpperCase() === "ERROR" ? 1 : 0), 0),
    [logs],
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-sm">{t("deepTrace.title")}</CardTitle>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-300">
              <Badge variant="default">
                {t("deepTrace.spans")}: {Object.keys(store.spans).length}
              </Badge>
              <Badge variant="info">
                {t("deepTrace.logs")}: {logs.length}
              </Badge>
              <Badge variant={errorCount > 0 ? "error" : "default"}>
                {t("deepTrace.errors")}: {errorCount}
              </Badge>
              <Badge variant="default">
                {t("deepTrace.duration")}: {formatDurationMs(durationMs)}
              </Badge>
              <Badge variant="default">
                {t("deepTrace.zoom")}: {(pxPerMs * 1000).toFixed(pxPerMs >= 0.2 ? 0 : 1)}px/s
              </Badge>
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
              <Button
                type="button"
                variant="ghost"
                className="h-10 px-2"
                onClick={gotoPrevMatch}
                disabled={!matchingSpanIds.length}
                aria-label={t("common.prev")}
              >
                <ChevronRight className="h-4 w-4 rotate-180" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-10 px-2"
                onClick={gotoNextMatch}
                disabled={!matchingSpanIds.length}
                aria-label={t("common.next")}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" className="h-10 px-2" onClick={fitToViewport}>
                {t("common.fit")}
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
            <div className="flex h-[70vh]">
              <div
                ref={leftScrollRef}
                className="h-full w-[340px] shrink-0 overflow-y-auto overflow-x-hidden border-r border-white/10"
                onScroll={onLeftScroll}
              >
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
                          top: virtualRow.start,
                          left: 0,
                          width: "100%",
                          height: virtualRow.size,
                        }}
                      >
                        <SpanTreeRow
                          span={span}
                          collapsed={isCollapsed}
                          onToggleCollapse={() => toggleCollapse(spanId)}
                          selected={selected}
                          onSelect={() => setSelectedSpanId(spanId)}
                          highlighted={isMatch}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              <div
                ref={rightScrollRef}
                className="h-full min-w-0 flex-1 overflow-auto"
                onScroll={onRightScroll}
                onWheel={onWheel}
              >
                <div style={{ width: timelineWidth }}>
                  <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                      const spanId = visibleSpanIds[virtualRow.index];
                      const span = store.spans[spanId];
                      const selected = selectedSpanId === spanId;
                      const isMatch = matchingSpanIds[matchIndex] === spanId;

                      return (
                        <div
                          key={spanId}
                          style={{
                            position: "absolute",
                            top: virtualRow.start,
                            left: 0,
                            width: "100%",
                            height: virtualRow.size,
                          }}
                        >
                          <SpanTimelineRow
                            span={span}
                            pxPerMs={pxPerMs}
                            criticalPath={criticalPath}
                            criticalOnly={criticalOnly}
                            selected={selected}
                            onSelect={() => setSelectedSpanId(spanId)}
                            highlighted={isMatch}
                          />
                        </div>
                      );
                    })}
                  </div>
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

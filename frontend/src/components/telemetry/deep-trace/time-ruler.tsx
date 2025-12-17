"use client";

import { shortId } from "@/lib/telemetry";
import type { DeepTraceStore } from "@/lib/deep-trace";

import { LEFT_COL_PX } from "./constants";
import { formatDurationMs, formatTickLabel, niceStepMs } from "./format";

export function TimeRuler({
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
  const timelineViewportWidth = Math.max(0, viewportWidth - LEFT_COL_PX);
  const visibleWidth = timelineViewportWidth;
  const startMs = scrollLeft / pxPerMs;
  const endMs = (scrollLeft + visibleWidth) / pxPerMs;
  const stepMs = niceStepMs(120 / pxPerMs);

  const first = Math.max(0, Math.floor(startMs / stepMs) * stepMs);
  const ticks: number[] = [];
  for (let t = first; t <= Math.min(endMs + stepMs, durationMs); t += stepMs) ticks.push(t);

  return (
    <div className="flex h-10 items-center border-b border-white/10 bg-black/20">
      <div className="sticky left-0 z-10 flex h-10 w-[340px] shrink-0 items-center gap-2 border-r border-white/10 bg-black/30 px-3 text-xs text-zinc-300">
        <span className="font-medium">{shortId(store.meta.traceId, 28)}</span>
        <span className="text-zinc-500">·</span>
        <span className="text-zinc-400">{formatDurationMs(durationMs)}</span>
      </div>

      <div className="relative h-10 flex-1 overflow-hidden">
        <div
          className="relative h-10"
          style={{
            width: Math.max(timelineViewportWidth, durationMs * pxPerMs + 1),
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

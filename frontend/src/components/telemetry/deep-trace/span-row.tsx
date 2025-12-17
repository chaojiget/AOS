"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import type { DeepTraceSpan } from "@/lib/deep-trace";
import { cn } from "@/lib/utils";

import { MIN_BAR_PX } from "./constants";
import { kindColor } from "./colors";
import { formatDurationMs } from "./format";

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

type RowInteractionProps = {
  selected: boolean;
  highlighted: boolean;
  onSelect: () => void;
};

function useRowInteraction(onSelect: () => void) {
  return {
    onClick: onSelect,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect();
      }
    },
    role: "button" as const,
    tabIndex: 0,
  };
}

export function SpanTreeRow({
  span,
  collapsed,
  onToggleCollapse,
  selected,
  highlighted,
  onSelect,
}: {
  span: DeepTraceSpan;
  collapsed: boolean;
  onToggleCollapse: () => void;
} & RowInteractionProps) {
  const interactions = useRowInteraction(onSelect);
  const hasChildren = span.children.length > 0;

  return (
    <div
      className={cn(
        "flex h-[38px] items-center gap-2 border-b border-white/5 bg-black/30 px-2 text-sm",
        selected ? "bg-white/10" : "hover:bg-white/5",
        highlighted && "outline outline-1 outline-amber-300/60",
      )}
      aria-pressed={selected}
      {...interactions}
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
        aria-expanded={hasChildren ? !collapsed : undefined}
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
  );
}

export function SpanTimelineRow({
  span,
  pxPerMs,
  criticalPath,
  criticalOnly,
  selected,
  highlighted,
  onSelect,
}: {
  span: DeepTraceSpan;
  pxPerMs: number;
  criticalPath: Set<string>;
  criticalOnly: boolean;
} & RowInteractionProps) {
  const interactions = useRowInteraction(onSelect);

  const isCritical = criticalPath.has(span.id);
  const dim = criticalOnly && !isCritical;

  const left = span.startOffsetMs * pxPerMs;
  const width = Math.max(span.durationMs * pxPerMs, MIN_BAR_PX);
  const barLabel =
    width > 120
      ? `${span.name} · ${formatDurationMs(span.durationMs)}`
      : width > 60
        ? formatDurationMs(span.durationMs)
        : "";

  return (
    <div
      className={cn(
        "relative h-[38px] border-b border-white/5 text-sm",
        selected ? "bg-white/10" : "hover:bg-white/5",
        highlighted && "outline outline-1 outline-amber-300/60",
      )}
      aria-pressed={selected}
      {...interactions}
    >
      <div className="relative h-[38px] w-full">
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
  );
}

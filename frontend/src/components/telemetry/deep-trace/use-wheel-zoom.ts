"use client";

import * as React from "react";

import { MAX_PX_PER_MS, MIN_PX_PER_MS } from "./constants";
import { clamp } from "./format";

type Args = {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  pxPerMs: number;
  setPxPerMs: (next: number) => void;
  onScrollLeftChange?: (scrollLeft: number) => void;
};

export function useWheelZoom({ scrollRef, pxPerMs, setPxPerMs, onScrollLeftChange }: Args) {
  return React.useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (!e.ctrlKey) return;
      e.preventDefault();

      const el = scrollRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const timelineViewportWidth = Math.max(0, rect.width);
      const anchorX = clamp(e.clientX - rect.left, 0, timelineViewportWidth);
      const timeAtPointer = (el.scrollLeft + anchorX) / pxPerMs;

      const factor = Math.exp(-e.deltaY * 0.001);
      const next = clamp(pxPerMs * factor, MIN_PX_PER_MS, MAX_PX_PER_MS);

      setPxPerMs(next);

      requestAnimationFrame(() => {
        const nextScrollLeft = timeAtPointer * next - anchorX;
        el.scrollLeft = Math.max(0, nextScrollLeft);
        onScrollLeftChange?.(el.scrollLeft);
      });
    },
    [onScrollLeftChange, pxPerMs, scrollRef, setPxPerMs],
  );
}

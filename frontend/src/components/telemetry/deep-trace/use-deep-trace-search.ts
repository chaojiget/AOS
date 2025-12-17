"use client";

import * as React from "react";

import type { DeepTraceSpan } from "@/lib/deep-trace";

type Args = {
  visibleSpanIds: string[];
  spans: Record<string, DeepTraceSpan>;
  onJumpToSpan: (spanId: string) => void;
};

export function useDeepTraceSearch({ visibleSpanIds, spans, onJumpToSpan }: Args) {
  const [query, setQuery] = React.useState("");
  const [matchIndex, setMatchIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const matchingSpanIds = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return visibleSpanIds.filter((id) => {
      const span = spans[id];
      return (
        span.name.toLowerCase().includes(q) ||
        span.id.toLowerCase().includes(q) ||
        (q === "error" && span.totalErrorCount > 0)
      );
    });
  }, [query, spans, visibleSpanIds]);

  React.useEffect(() => {
    setMatchIndex(0);
  }, [query]);

  const jumpTo = React.useCallback(
    (nextIndex: number) => {
      if (matchingSpanIds.length === 0) return;
      const idx =
        ((nextIndex % matchingSpanIds.length) + matchingSpanIds.length) %
        matchingSpanIds.length;
      setMatchIndex(idx);
      onJumpToSpan(matchingSpanIds[idx]);
    },
    [matchingSpanIds, onJumpToSpan],
  );

  const gotoNextMatch = React.useCallback(() => {
    jumpTo(matchIndex + 1);
  }, [jumpTo, matchIndex]);

  const gotoPrevMatch = React.useCallback(() => {
    jumpTo(matchIndex - 1);
  }, [jumpTo, matchIndex]);

  const gotoNextMatchRef = React.useRef(gotoNextMatch);
  React.useEffect(() => {
    gotoNextMatchRef.current = gotoNextMatch;
  }, [gotoNextMatch]);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (e.key === "Enter" && document.activeElement === inputRef.current) {
        e.preventDefault();
        gotoNextMatchRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return {
    query,
    setQuery,
    inputRef,
    matchingSpanIds,
    matchIndex,
    gotoNextMatch,
    gotoPrevMatch,
  };
}

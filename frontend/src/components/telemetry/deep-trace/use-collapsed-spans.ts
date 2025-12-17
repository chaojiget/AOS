"use client";

import * as React from "react";

import type { DeepTraceStore } from "@/lib/deep-trace";

export function useCollapsedSpans(store: DeepTraceStore) {
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());

  React.useEffect(() => {
    setCollapsed(new Set());
  }, [store.meta.traceId]);

  const toggleCollapse = React.useCallback((spanId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  }, []);

  const expandAll = React.useCallback(() => setCollapsed(new Set()), []);

  const collapseAll = React.useCallback(() => {
    const next = new Set<string>();
    for (const span of Object.values(store.spans)) if (span.children.length) next.add(span.id);
    setCollapsed(next);
  }, [store.spans]);

  return { collapsed, toggleCollapse, expandAll, collapseAll };
}

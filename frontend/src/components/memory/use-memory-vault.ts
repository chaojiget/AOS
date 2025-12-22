"use client";

import * as React from "react";

import { apiGet, apiPost } from "@/lib/api";
import type { MemoryItem } from "@/lib/memory";

export type MemoryVaultState = {
  items: MemoryItem[];
  isLoading: boolean;
  error: string | null;
  query: string;
  setQuery: (value: string) => void;
  limit: number;
  setLimit: (value: number) => void;
  traceIdToDistill: string;
  setTraceIdToDistill: (value: string) => void;
  isDistilling: boolean;
  distillError: string | null;
  refresh: () => Promise<void>;
  distill: (options?: { overwrite?: boolean }) => Promise<void>;
};

export function useMemoryVault(initialLimit = 20): MemoryVaultState {
  const [items, setItems] = React.useState<MemoryItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [query, setQuery] = React.useState("");
  const [limit, setLimit] = React.useState(initialLimit);

  const [traceIdToDistill, setTraceIdToDistill] = React.useState("");
  const [isDistilling, setIsDistilling] = React.useState(false);
  const [distillError, setDistillError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (query.trim()) params.set("query", query.trim());
      const data = await apiGet<MemoryItem[]>(`/api/v1/memory/recall?${params.toString()}`);
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [limit, query]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const distill = React.useCallback(
    async (options?: { overwrite?: boolean }) => {
      const traceId = traceIdToDistill.trim();
      if (!traceId) return;

      setIsDistilling(true);
      setDistillError(null);
      try {
        await apiPost<MemoryItem>("/api/v1/memory/consolidate", {
          trace_id: traceId,
          overwrite: options?.overwrite ?? true,
        });
        await refresh();
      } catch (err) {
        setDistillError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsDistilling(false);
      }
    },
    [refresh, traceIdToDistill],
  );

  return {
    items,
    isLoading,
    error,
    query,
    setQuery,
    limit,
    setLimit,
    traceIdToDistill,
    setTraceIdToDistill,
    isDistilling,
    distillError,
    refresh,
    distill,
  };
}

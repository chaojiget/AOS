"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";

import { useI18n } from "@/i18n";
import { apiGet } from "@/lib/api";
import { TraceSummary, TelemetryLog, humanTime, shortId } from "@/lib/telemetry";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DeepTraceObserver } from "@/components/telemetry/deep-trace-observer";

const WINDOW_OPTIONS = [
  { key: "traceChain.window5m", seconds: 5 * 60 },
  { key: "traceChain.window30m", seconds: 30 * 60 },
  { key: "traceChain.window2h", seconds: 2 * 60 * 60 },
  { key: "traceChain.window24h", seconds: 24 * 60 * 60 },
] as const;

function parseMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function toIsoNoZ(ms: number): string {
  const date = new Date(ms);
  const pad2 = (v: number) => String(v).padStart(2, "0");
  const pad3 = (v: number) => String(v).padStart(3, "0");
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.${pad3(date.getMilliseconds())}`;
}

export function TraceChainView() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [traces, setTraces] = React.useState<TraceSummary[]>([]);
  const [traceFilter, setTraceFilter] = React.useState("");
  const [selectedTraceId, setSelectedTraceId] = React.useState<string | null>(null);
  const [logs, setLogs] = React.useState<TelemetryLog[]>([]);
  const [windowSeconds, setWindowSeconds] = React.useState<number>(WINDOW_OPTIONS[1].seconds);
  const [windowEndMs, setWindowEndMs] = React.useState<number | null>(null);
  const [isLoadingTraces, setIsLoadingTraces] = React.useState(false);
  const [isLoadingLogs, setIsLoadingLogs] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const loadTraces = React.useCallback(async () => {
    setIsLoadingTraces(true);
    setError(null);
    try {
      const data = await apiGet<TraceSummary[]>("/api/v1/telemetry/traces?limit=120");
      setTraces(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingTraces(false);
    }
  }, []);

  const loadLogs = React.useCallback(async (traceId: string, options?: { startMs?: number; endMs?: number; limit?: number }) => {
    setIsLoadingLogs(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (options?.limit != null) params.set("limit", String(options.limit));
      if (options?.startMs != null) params.set("start", toIsoNoZ(options.startMs));
      if (options?.endMs != null) params.set("end", toIsoNoZ(options.endMs));

      const qs = params.toString();
      const url = `/api/v1/telemetry/traces/${encodeURIComponent(traceId)}/logs${qs ? `?${qs}` : ""}`;
      const data = await apiGet<TelemetryLog[]>(url);
      setLogs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLogs([]);
    } finally {
      setIsLoadingLogs(false);
    }
  }, []);

  React.useEffect(() => {
    void loadTraces();
  }, [loadTraces]);

  React.useEffect(() => {
    const traceId = searchParams.get("traceId");
    if (traceId && traceId !== selectedTraceId) {
      setSelectedTraceId(traceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loadLogs]);

  const selectedTrace = React.useMemo(
    () => traces.find((trace) => trace.trace_id === selectedTraceId) ?? null,
    [selectedTraceId, traces],
  );

  const filteredTraces = React.useMemo(() => {
    if (!traceFilter.trim()) return traces;
    const needle = traceFilter.trim().toLowerCase();
    return traces.filter((trace) => trace.trace_id.toLowerCase().includes(needle));
  }, [traceFilter, traces]);

  const selectTrace = (trace: TraceSummary) => {
    setSelectedTraceId(trace.trace_id);
    setWindowEndMs(parseMs(trace.last_time));
    const params = new URLSearchParams(searchParams.toString());
    params.set("traceId", trace.trace_id);
    router.replace(`${pathname}?${params.toString()}`);
  };

  React.useEffect(() => {
    if (!selectedTraceId) return;
    const last = parseMs(selectedTrace?.last_time) ?? Date.now();
    const endMs = windowEndMs ?? last;
    const startMs = endMs - windowSeconds * 1000;
    void loadLogs(selectedTraceId, { startMs, endMs, limit: 4000 });
  }, [loadLogs, selectedTrace?.last_time, selectedTraceId, windowEndMs, windowSeconds]);

  const loadedStartTs = logs.length ? logs[0].timestamp : null;
  const loadedEndTs = logs.length ? logs[logs.length - 1].timestamp : null;
  const loadedStartMs = loadedStartTs ? parseMs(loadedStartTs) : null;
  const loadedEndMs = loadedEndTs ? parseMs(loadedEndTs) : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t("nav.traceChain")}</h1>
          <p className="mt-1 text-sm text-zinc-300">{t("traceChain.subtitle")}</p>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={() => void loadTraces()} disabled={isLoadingTraces}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
        <Card className="h-fit">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm">{t("traceChain.traceList")}</CardTitle>
            <div className="text-xs text-zinc-400">
              {isLoadingTraces
                ? t("common.loading")
                : traceFilter.trim()
                  ? `${filteredTraces.length}/${traces.length}`
                  : `${traces.length}`}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-zinc-500" />
              <Input
                value={traceFilter}
                onChange={(e) => setTraceFilter(e.target.value)}
                placeholder={t("traceChain.filterPlaceholder")}
                className="pl-9"
              />
            </div>

            <div className="max-h-[60vh] overflow-auto pr-1">
              <div className="flex flex-col gap-2">
                {filteredTraces.length === 0 ? (
                  <div className="text-sm text-zinc-400">{t("common.empty")}</div>
                ) : null}
                {filteredTraces.map((trace) => {
                  const selected = trace.trace_id === selectedTraceId;
                  return (
                    <button
                      key={trace.trace_id}
                      type="button"
                      onClick={() => selectTrace(trace)}
                      className={[
                        "rounded-lg border px-3 py-2 text-left",
                        selected
                          ? "border-white/20 bg-white/10"
                          : "border-white/10 bg-white/5 hover:bg-white/10",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">{shortId(trace.trace_id, 18)}</div>
                        <div className="flex items-center gap-2">
                          {trace.errors > 0 ? (
                            <span className="rounded-md bg-red-500/20 px-2 py-0.5 text-xs text-red-200">
                              ! {trace.errors}
                            </span>
                          ) : null}
                          <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs text-zinc-300">
                            {trace.entries}
                          </span>
                        </div>
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs text-zinc-300">
                        {trace.span_name ? `${trace.span_name} — ` : ""}
                        {trace.last_message ?? ""}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-sm">{t("traceChain.selectedTrace")}</CardTitle>
              <div className="flex items-center gap-2">
                {selectedTraceId ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-9 px-2"
                    onClick={() => setWindowEndMs(parseMs(selectedTrace?.last_time) ?? Date.now())}
                    disabled={isLoadingLogs}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {t("common.refresh")}
                  </Button>
                ) : null}
                <div className="text-xs text-zinc-400">
                  {isLoadingLogs ? t("common.loading") : selectedTraceId ? shortId(selectedTraceId, 24) : "-"}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {!selectedTraceId ? (
                <div className="text-sm text-zinc-400">{t("traceChain.selectHint")}</div>
              ) : logs.length === 0 && !isLoadingLogs ? (
                <div className="text-sm text-zinc-400">{t("traceChain.noLogs")}</div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs text-zinc-400">
                      {t("traceChain.range")}{" "}
                      {loadedStartTs && loadedEndTs
                        ? `${humanTime(loadedStartTs, lang)} → ${humanTime(loadedEndTs, lang)}`
                        : "-"}
                      <span className="ml-2 text-zinc-500">·</span>
                      <span className="ml-2 text-zinc-300">{logs.length}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-2">
                        <div className="text-xs text-zinc-400">{t("traceChain.window")}</div>
                        <select
                          className="h-9 rounded-md border border-white/10 bg-black/20 px-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-white/20"
                          value={windowSeconds}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            setWindowSeconds(next);
                            setWindowEndMs(parseMs(selectedTrace?.last_time) ?? Date.now());
                          }}
                        >
                          {WINDOW_OPTIONS.map((opt) => (
                            <option key={opt.seconds} value={opt.seconds}>
                              {t(opt.key)}
                            </option>
                          ))}
                        </select>
                      </div>

                      <Button
                        type="button"
                        variant="secondary"
                        className="h-9 px-2"
                        onClick={() => {
                          if (loadedStartMs == null) return;
                          setWindowEndMs(loadedStartMs);
                        }}
                        disabled={loadedStartMs == null || isLoadingLogs}
                      >
                        <ChevronLeft className="mr-1 h-4 w-4" />
                        {t("traceChain.earlier")}
                      </Button>

                      <Button
                        type="button"
                        variant="secondary"
                        className="h-9 px-2"
                        onClick={() => {
                          const last = parseMs(selectedTrace?.last_time);
                          if (last == null || windowEndMs == null) return;
                          setWindowEndMs(Math.min(last, windowEndMs + windowSeconds * 1000));
                        }}
                        disabled={windowEndMs == null || isLoadingLogs}
                      >
                        {t("traceChain.later")}
                        <ChevronRight className="ml-1 h-4 w-4" />
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        className="h-9 px-2"
                        onClick={() => setWindowEndMs(parseMs(selectedTrace?.last_time) ?? Date.now())}
                        disabled={isLoadingLogs}
                      >
                        {t("traceChain.latest")}
                      </Button>
                    </div>
                  </div>

                  <DeepTraceObserver logs={logs} />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

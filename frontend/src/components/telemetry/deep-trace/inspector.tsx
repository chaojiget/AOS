"use client";

import { X } from "lucide-react";

import { useI18n } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DeepTraceStore } from "@/lib/deep-trace";
import { humanTime } from "@/lib/telemetry";

import { formatDurationMs } from "./format";

export function Inspector({
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
                    <Badge
                      variant={
                        log.level.toUpperCase() === "ERROR"
                          ? "error"
                          : log.level.toUpperCase() === "INFO"
                            ? "info"
                            : "default"
                      }
                    >
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

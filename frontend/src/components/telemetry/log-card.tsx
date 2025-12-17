"use client";

import Link from "next/link";
import { ChevronRight, Copy } from "lucide-react";

import { useI18n } from "@/i18n";
import { TelemetryLog, getLevelVariant, humanTime } from "@/lib/telemetry";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // ignore
  }
}

export function LogCard({ log }: { log: TelemetryLog }) {
  const { t, lang } = useI18n();
  const levelVariant = getLevelVariant(log.level);

  const traceId = log.trace_id ?? undefined;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={levelVariant}>{log.level}</Badge>
            <div className="text-xs text-zinc-400">{humanTime(log.timestamp, lang)}</div>
            {log.logger_name ? (
              <div className="truncate text-xs text-zinc-400">{log.logger_name}</div>
            ) : null}
          </div>
          <CardTitle className="mt-2 break-words text-sm font-medium">{log.message}</CardTitle>
        </div>

        {traceId ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              className="h-9 px-2"
              onClick={() => copyText(traceId)}
              aria-label={t("common.copyTraceId")}
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button asChild className="h-9 px-3">
              <Link href={`/telemetry/trace-chain?traceId=${encodeURIComponent(traceId)}`}>
                {t("common.openTraceChain")}
                <ChevronRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="pt-0">
        <details className="group">
          <summary className="cursor-pointer select-none text-xs text-zinc-300 hover:text-white">
            {t("common.details")}
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-zinc-200">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-zinc-400">trace_id</span>
              <span className={cn("break-all", traceId ? "text-zinc-200" : "text-zinc-500")}>
                {traceId ?? "-"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-zinc-400">span_id</span>
              <span className="break-all text-zinc-200">{log.span_id ?? "-"}</span>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <pre className="whitespace-pre-wrap break-words text-[11px] text-zinc-200">
                {JSON.stringify(log.attributes ?? null, null, 2)}
              </pre>
            </div>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}


"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";

import { useI18n } from "@/i18n";
import type { MemoryItem } from "@/lib/memory";
import { humanTime, shortId } from "@/lib/telemetry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function tagsToList(tags: string | null | undefined): string[] {
  if (!tags) return [];
  return tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function formatTraceId(traceId: string | null): string {
  if (!traceId) return "-";
  return shortId(traceId, 24);
}

export function MemoryItemCard({ item }: { item: MemoryItem }) {
  const { t, lang } = useI18n();
  const tags = tagsToList(item.tags);
  const traceId = item.source_trace_id;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info">
              <span className="inline-flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5" />
                {t("memory.card")}
              </span>
            </Badge>
            <div className="text-xs text-zinc-400">{humanTime(item.created_at, lang)}</div>
            {traceId ? <Badge variant="default">{formatTraceId(traceId)}</Badge> : null}
          </div>
          <CardTitle className="mt-2 break-words text-sm font-medium">{item.title}</CardTitle>
        </div>

        {traceId ? (
          <Button asChild variant="secondary" className="h-9 px-3">
            <Link href={`/telemetry/trace-chain?traceId=${encodeURIComponent(traceId)}`}>{t("memory.openTrace")}</Link>
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="pt-0">
        <div className="prose prose-invert max-w-none text-sm prose-p:my-2">
          <p className="whitespace-pre-wrap break-words text-zinc-200">{item.content}</p>
        </div>

        {tags.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <Badge key={tag} variant="default">
                #{tag}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

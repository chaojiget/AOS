"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { useI18n } from "@/i18n";
import {
  SpanNode,
  TelemetryLog,
  buildSpanForest,
  getLevelVariant,
  humanTime,
  shortId,
} from "@/lib/telemetry";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

function SpanNodeView({
  node,
  depth,
  expanded,
  onToggle,
}: {
  node: SpanNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (spanId: string) => void;
}) {
  const { lang } = useI18n();
  const isOpen = expanded.has(node.spanId);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => onToggle(node.spanId)}
        className={cn(
          "flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left hover:bg-white/10",
        )}
        aria-expanded={isOpen}
      >
        <div className="flex min-w-0 items-start gap-2">
          <IndentGuides depth={depth} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {isOpen ? (
                <ChevronDown className="h-4 w-4 shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0" />
              )}
              <div className="truncate text-sm font-medium">
                {node.name ?? shortId(node.spanId, 14)}
              </div>
              <div className="text-xs text-zinc-400">{shortId(node.spanId, 10)}</div>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <span>{node.logs.length} logs</span>
              {node.parentSpanId ? (
                <span>parent: {shortId(node.parentSpanId, 10)}</span>
              ) : (
                <span>root</span>
              )}
            </div>
          </div>
        </div>
      </button>

      {isOpen ? (
        <div className="flex flex-col gap-2">
          {node.logs.length ? (
            <div className="flex flex-col gap-2">
              {node.logs.map((log) => (
                <div key={log.id} className="flex gap-2">
                  <IndentGuides depth={depth + 1} />
                  <div className="min-w-0 flex-1">
                    <LogRow log={log} lang={lang} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {node.children.length ? (
            <div className="flex flex-col gap-2">
              {node.children.map((child) => (
                <SpanNodeView
                  key={child.spanId}
                  node={child}
                  depth={depth + 1}
                  expanded={expanded}
                  onToggle={onToggle}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function LogRow({ log, lang }: { log: TelemetryLog; lang: "zh" | "en" }) {
  const levelVariant = getLevelVariant(log.level);
  return (
    <details className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
      <summary className="cursor-pointer select-none">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={levelVariant}>{log.level}</Badge>
          <div className="text-xs text-zinc-400">{humanTime(log.timestamp, lang)}</div>
          <div className="min-w-0 flex-1 truncate text-sm text-zinc-100">{log.message}</div>
        </div>
      </summary>
      <div className="mt-2 rounded-md border border-white/10 bg-black/20 p-2">
        <pre className="whitespace-pre-wrap break-words text-[11px] text-zinc-200">
          {JSON.stringify(log.attributes ?? null, null, 2)}
        </pre>
      </div>
    </details>
  );
}

export function SpanTree({ logs }: { logs: TelemetryLog[] }) {
  const { t, lang } = useI18n();
  const forest = React.useMemo(() => buildSpanForest(logs), [logs]);

  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(forest.roots.map((n) => n.spanId)));

  React.useEffect(() => {
    setExpanded(new Set(forest.roots.map((n) => n.spanId)));
  }, [forest.roots]);

  const toggle = (spanId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  };

  const expandAll = () => {
    setExpanded(new Set(Array.from(forest.byId.keys())));
  };

  const collapseAll = () => {
    setExpanded(new Set());
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-sm">{t("traceChain.treeTitle")}</CardTitle>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" className="h-9 px-2" onClick={expandAll}>
              {t("common.expandAll")}
            </Button>
            <Button type="button" variant="ghost" className="h-9 px-2" onClick={collapseAll}>
              {t("common.collapseAll")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {forest.roots.length === 0 ? (
            <div className="text-sm text-zinc-400">{t("traceChain.noSpans")}</div>
          ) : (
            forest.roots.map((node) => (
              <SpanNodeView
                key={node.spanId}
                node={node}
                depth={0}
                expanded={expanded}
                onToggle={toggle}
              />
            ))
          )}
        </CardContent>
      </Card>

      {forest.orphanLogs.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("traceChain.orphanLogs")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {forest.orphanLogs.map((log) => (
              <LogRow key={log.id} log={log} lang={lang} />
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

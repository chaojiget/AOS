"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";

import { useI18n } from "@/i18n";
import { apiGet } from "@/lib/api";
import { TelemetryLog } from "@/lib/telemetry";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LogCard } from "@/components/telemetry/log-card";

const LEVELS = ["", "ERROR", "WARN", "INFO", "DEBUG"] as const;
type LevelFilter = (typeof LEVELS)[number];

export function NeuralStreamView() {
  const { t } = useI18n();
  const [logs, setLogs] = React.useState<TelemetryLog[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [limit, setLimit] = React.useState(200);
  const [level, setLevel] = React.useState<LevelFilter>("");
  const [search, setSearch] = React.useState("");

  const load = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (level) params.set("levels", level);
      if (search.trim()) params.set("search", search.trim());
      const data = await apiGet<TelemetryLog[]>(`/api/v1/telemetry/logs?${params.toString()}`);
      setLogs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [level, limit, search]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t("nav.neuralStream")}</h1>
          <p className="mt-1 text-sm text-zinc-300">{t("neuralStream.subtitle")}</p>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={() => void load()} disabled={isLoading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle className="text-sm">{t("common.filters")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <div className="text-xs text-zinc-400">{t("common.level")}</div>
            <select
              className="h-10 w-full rounded-md border border-white/10 bg-black/20 px-3 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-white/20"
              value={level}
              onChange={(e) => setLevel(e.target.value as LevelFilter)}
            >
              <option value="">{t("common.all")}</option>
              <option value="ERROR">ERROR</option>
              <option value="WARN">WARN</option>
              <option value="INFO">INFO</option>
              <option value="DEBUG">DEBUG</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-xs text-zinc-400">{t("common.limit")}</div>
            <Input
              type="number"
              min={10}
              max={1000}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value || 200))}
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-xs text-zinc-400">{t("common.searchOptional")}</div>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("common.search")} />
          </div>
        </CardContent>
      </Card>

      {error ? (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="mt-5 flex flex-col gap-3">
        {isLoading ? <div className="text-sm text-zinc-300">{t("common.loading")}</div> : null}
        {!isLoading && logs.length === 0 ? (
          <div className="text-sm text-zinc-400">{t("common.empty")}</div>
        ) : null}
        {logs.map((log) => (
          <LogCard key={log.id} log={log} />
        ))}
      </div>
    </div>
  );
}


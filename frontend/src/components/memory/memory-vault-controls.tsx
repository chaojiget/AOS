"use client";

import { Search, Wand2 } from "lucide-react";

import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type MemoryVaultControlsProps = {
  query: string;
  onQueryChange: (value: string) => void;
  limit: number;
  onLimitChange: (value: number) => void;
  traceIdToDistill: string;
  onTraceIdToDistillChange: (value: string) => void;
  isLoading: boolean;
  itemCount: number;
  isDistilling: boolean;
  distillError: string | null;
  onDistill: () => void;
};

export function MemoryVaultControls(props: MemoryVaultControlsProps) {
  const { t } = useI18n();

  return (
    <Card className="mt-5">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-sm">{t("memory.controls")}</CardTitle>
        <div className="text-xs text-zinc-400">{props.isLoading ? t("common.loading") : `${props.itemCount}`}</div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <div className="text-xs text-zinc-400">{t("common.search")}</div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-zinc-500" />
            <Input
              value={props.query}
              onChange={(e) => props.onQueryChange(e.target.value)}
              placeholder={t("memory.searchPlaceholder")}
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-xs text-zinc-400">{t("common.limit")}</div>
          <Input
            type="number"
            min={5}
            max={200}
            value={props.limit}
            onChange={(e) => props.onLimitChange(Number(e.target.value || 20))}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-xs text-zinc-400">{t("memory.distill")}</div>
          <div className="flex items-center gap-2">
            <Input
              value={props.traceIdToDistill}
              onChange={(e) => props.onTraceIdToDistillChange(e.target.value)}
              placeholder={t("memory.traceIdPlaceholder")}
            />
            <Button type="button" onClick={props.onDistill} disabled={props.isDistilling || !props.traceIdToDistill.trim()}>
              <Wand2 className="mr-2 h-4 w-4" />
              {t("memory.distillBtn")}
            </Button>
          </div>
          {props.distillError ? <div className="text-xs text-red-200">{props.distillError}</div> : null}
        </div>
      </CardContent>
    </Card>
  );
}

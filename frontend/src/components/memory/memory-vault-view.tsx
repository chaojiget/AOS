"use client";

import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { MemoryItemCard } from "@/components/memory/memory-item-card";
import { MemoryVaultControls } from "@/components/memory/memory-vault-controls";
import { useMemoryVault } from "@/components/memory/use-memory-vault";

export function MemoryVaultView() {
  const { t } = useI18n();
  const state = useMemoryVault(20);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t("nav.memoryVault")}</h1>
          <p className="mt-1 text-sm text-zinc-300">{t("memory.subtitle")}</p>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={() => void state.refresh()} disabled={state.isLoading}>
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      <MemoryVaultControls
        query={state.query}
        onQueryChange={state.setQuery}
        limit={state.limit}
        onLimitChange={state.setLimit}
        traceIdToDistill={state.traceIdToDistill}
        onTraceIdToDistillChange={state.setTraceIdToDistill}
        isLoading={state.isLoading}
        itemCount={state.items.length}
        isDistilling={state.isDistilling}
        distillError={state.distillError}
        onDistill={() => void state.distill({ overwrite: true })}
      />

      {state.error ? (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{state.error}</div>
      ) : null}

      <div className="mt-5 flex flex-col gap-3">
        {state.isLoading ? <div className="text-sm text-zinc-300">{t("common.loading")}</div> : null}
        {!state.isLoading && state.items.length === 0 ? (
          <div className="text-sm text-zinc-400">{t("memory.empty")}</div>
        ) : null}
        {state.items.map((item) => (
          <MemoryItemCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

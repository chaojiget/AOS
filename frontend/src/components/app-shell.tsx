"use client";

import Link from "next/link";
import { Activity, Bot, GitBranch, Home, Vault } from "lucide-react";
import type { ReactNode } from "react";

import { LanguageToggle } from "@/components/language-toggle";
import { useI18n } from "@/i18n";

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-white/5 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-sm font-medium text-zinc-100">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
              <Home className="h-4 w-4" />
            </span>
            <span className="hidden sm:inline">AOS</span>
          </Link>

          <nav className="flex items-center gap-1">
            <Link
              href="/telemetry/neural-stream"
              className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-200 hover:bg-white/10"
            >
              <Activity className="h-4 w-4" />
              <span className="hidden sm:inline">{t("nav.neuralStream")}</span>
            </Link>
            <Link
              href="/telemetry/trace-chain"
              className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-200 hover:bg-white/10"
            >
              <GitBranch className="h-4 w-4" />
              <span className="hidden sm:inline">{t("nav.traceChain")}</span>
            </Link>
            <Link
              href="/memory/vault"
              className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-200 hover:bg-white/10"
            >
              <Vault className="h-4 w-4" />
              <span className="hidden sm:inline">{t("nav.memoryVault")}</span>
            </Link>
            <Link
              href="/agent/chat"
              className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-200 hover:bg-white/10"
            >
              <Bot className="h-4 w-4" />
              <span className="hidden sm:inline">{t("nav.agentChat")}</span>
            </Link>
          </nav>

          <LanguageToggle />
        </div>
      </header>

      <main>{children}</main>
    </div>
  );
}

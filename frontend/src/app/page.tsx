"use client";

import Link from "next/link";
import { Activity, GitBranch, ChevronRight } from "lucide-react";

import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function HomePage() {
  const { t } = useI18n();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("app.title")}</h1>
        <p className="text-sm text-zinc-300">{t("app.subtitle")}</p>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <Activity className="h-5 w-5 text-emerald-300" />
            <CardTitle>{t("nav.neuralStream")}</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <div className="text-sm text-zinc-300">{t("home.neuralStreamDesc")}</div>
            <Button asChild>
              <Link href="/telemetry/neural-stream">
                {t("common.open")}
                <ChevronRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <GitBranch className="h-5 w-5 text-sky-300" />
            <CardTitle>{t("nav.traceChain")}</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <div className="text-sm text-zinc-300">{t("home.traceChainDesc")}</div>
            <Button asChild>
              <Link href="/telemetry/trace-chain">
                {t("common.open")}
                <ChevronRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


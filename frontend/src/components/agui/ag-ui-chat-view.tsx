"use client";

import * as React from "react";
import { Bot, Send, Square } from "lucide-react";

import { useI18n } from "@/i18n";
import { useAgUiChat } from "@/components/agui/use-ag-ui-chat";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function AgUiChatView() {
  const { t } = useI18n();
  const chat = useAgUiChat();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await chat.send();
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t("nav.agentChat")}</h1>
        <p className="text-sm text-zinc-300">{t("agui.subtitle")}</p>
      </div>

      <Card className="mt-5">
        <CardHeader className="flex flex-row items-center gap-2">
          <Bot className="h-5 w-5 text-sky-300" />
          <CardTitle className="text-sm">{t("agui.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {chat.error ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{chat.error}</div>
          ) : null}

          <div className="min-h-[320px] rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="flex flex-col gap-3">
              {chat.messages.length === 0 ? (
                <div className="text-sm text-zinc-400">{t("agui.empty")}</div>
              ) : null}

              {chat.messages.map((m) => (
                <div
                  key={m.id}
                  className={
                    m.role === "user"
                      ? "ml-auto max-w-[85%] rounded-lg bg-sky-500/15 px-3 py-2 text-sm text-zinc-100"
                      : "mr-auto max-w-[85%] rounded-lg bg-white/10 px-3 py-2 text-sm text-zinc-100"
                  }
                >
                  <div className="whitespace-pre-wrap break-words">{m.content}</div>
                </div>
              ))}
            </div>
          </div>

          <form onSubmit={onSubmit} className="flex items-center gap-2">
            <Input
              value={chat.input}
              onChange={(e) => chat.setInput(e.target.value)}
              placeholder={t("agui.placeholder")}
              disabled={chat.isRunning}
            />
            <Button type="submit" disabled={!chat.input.trim() || chat.isRunning}>
              <Send className="mr-2 h-4 w-4" />
              {t("agui.send")}
            </Button>
            <Button type="button" variant="secondary" onClick={chat.abort} disabled={!chat.isRunning}>
              <Square className="mr-2 h-4 w-4" />
              {t("agui.stop")}
            </Button>
          </form>

          <div className="text-xs text-zinc-400">{t("agui.hint")}</div>
        </CardContent>
      </Card>
    </div>
  );
}

import React, { useRef, useState } from "react";
import { motion } from "framer-motion";
import { MessageSquare, Activity, ListTree, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getGridTemplateColumns, useResizer } from "@/lib/layout";
import { cn } from "@/lib/utils";

interface AppLayoutProps {
  leftPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  children: React.ReactNode;
}

export function AppLayout({ leftPanel, rightPanel, children }: AppLayoutProps) {
  const [tab, setTab] = useState<"convo" | "runs" | "skills" | "settings">("convo");
  const [running, setRunning] = useState(false);
  const { left, right, drag, setDrag } = useResizer(280, 360);
  const containerRef = useRef<HTMLDivElement | null>(null);

  return (
    <div className="h-screen w-full bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 flex flex-col">
      <header className="h-14 border-b border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 backdrop-blur sticky top-0 z-40">
        <div className="h-full max-w-7xl mx-auto px-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="font-semibold tracking-wide">AgentOS</div>
            <nav className="flex items-center gap-1 text-sm">
              {[
                { id: "convo", label: "会话", icon: MessageSquare },
                { id: "runs", label: "运行", icon: Activity },
                { id: "skills", label: "技能", icon: ListTree },
                { id: "settings", label: "设置", icon: Settings },
              ].map((t: any) => (
                <Button key={t.id} variant={tab === t.id ? "secondary" : "ghost"} onClick={() => setTab(t.id)} size="sm" className="gap-1">
                  <t.icon className="h-4 w-4" /> {t.label}
                </Button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Badge variant={running ? "secondary" : "default"}>{running ? "运行中" : "就绪"}</Badge>
          </div>
        </div>
      </header>

      <div ref={containerRef} className="relative max-w-7xl mx-auto h-[calc(100vh-56px)] grid" style={{ gridTemplateColumns: getGridTemplateColumns(left, right) }}>
        <aside className="border-r border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/50 overflow-hidden">
          {leftPanel}
        </aside>

        <main className="relative overflow-hidden flex flex-col">
          {children}
        </main>

        <aside className="border-l border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/40 overflow-hidden">
          {rightPanel}
        </aside>

        <div
          onMouseDown={() => setDrag("left")}
          title="拖拽调整宽度"
          className={cn(
            "absolute top-0 bottom-0 w-1 cursor-col-resize z-20",
            drag === "left" ? "bg-zinc-400/70" : "bg-transparent hover:bg-zinc-300/50 dark:hover:bg-zinc-700/50"
          )}
          style={{ left: left - 1 }}
        />
        <div
          onMouseDown={() => setDrag("right")}
          title="拖拽调整宽度"
          className={cn(
            "absolute top-0 bottom-0 w-1 cursor-col-resize z-20",
            drag === "right" ? "bg-zinc-400/70" : "bg-transparent hover:bg-zinc-300/50 dark:hover:bg-zinc-700/50"
          )}
          style={{ right: right - 1 }}
        />
      </div>
    </div>
  );
}

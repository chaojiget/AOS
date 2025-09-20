import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Check, Hash, Play, Loader2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const MOCK_MESSAGES = [
  { id: "m1", role: "user", text: "帮我写一份北海 2 日行程。" },
  { id: "m2", role: "assistant", text: "已为你规划两天路线，包含必看与本地餐厅，是否需要预算与地图链接？" },
  {
    id: "m-final",
    role: "assistant",
    text: `【最终答复·摘要】
Day1: 银滩-海滨公园-老街；Day2: 涠洲岛环线。含人均预算、门票与交通时间表。`,
  },
];

export function MainThread() {
  const [copied, setCopied] = useState(false);
  const [finalFlash, setFinalFlash] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);

  const finalMessage = useMemo(() => MOCK_MESSAGES.find((m) => m.id === "m-final"), []);

  function onCopy() {
    if (!finalMessage) return;
    navigator.clipboard.writeText(finalMessage.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }

  function onRun() {
    setRunning(true);
    // Demo：2s 后“完成”，触发 FinalAnswerBar 高亮
    setTimeout(() => {
      setRunning(false);
      setFinalFlash(true);
      setTimeout(() => setFinalFlash(false), 1600);
    }, 1800);
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      {/* Final Answer Bar */}
      <motion.div
        className="backdrop-blur border-b border-zinc-200 dark:border-zinc-800"
        initial={false}
        animate={finalFlash ? { boxShadow: "0 0 0 2px rgba(34,197,94,.6)" } : { boxShadow: "0 0 0 0 rgba(0,0,0,0)" }}
        transition={{ type: "spring", stiffness: 200, damping: 20 }}
        style={{ background: "linear-gradient(to bottom, rgba(24,24,27,.95), rgba(24,24,27,.6))" }}
      >
        <div className="px-4 py-3 flex items-start justify-between">
          <div className="min-w-0 pr-4">
            <div className="text-xs uppercase tracking-wide text-zinc-400 mb-1">最终答复</div>
            <div id="final" className="text-sm leading-6 whitespace-pre-wrap line-clamp-2">
              {finalMessage?.text || "尚无最终答复。运行一次以生成。"}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="secondary" size="sm" onClick={onCopy} className="gap-1">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} 复制
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <a href="#m-final">
                <Hash className="h-3.5 w-3.5" /> 定位
              </a>
            </Button>
          </div>
        </div>
      </motion.div>

      {/* 对话流 */}
      <div className="flex-1 overflow-auto px-4 py-4 space-y-3">
        <AnimatePresence initial={false}>
          {MOCK_MESSAGES.map((m) => {
            const expanded = expandedIds.has(m.id);
            return (
              <motion.div layout key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                <Card className={cn(m.role === "user" ? "" : "bg-zinc-50 dark:bg-zinc-900/60")}>
                  <CardHeader className="flex-row items-center justify-between p-3">
                    <div className="text-xs text-zinc-500">{m.role === "user" ? "用户" : "助手"}</div>
                    <Button variant="ghost" size="icon" onClick={() => toggleExpand(m.id)} className="-mr-2 h-7 w-7 opacity-0 group-hover:opacity-100">
                      <ChevronDown className={cn("h-4 w-4 transition", expanded && "rotate-180")} />
                    </Button>
                  </CardHeader>
                  <CardContent className="p-3 pt-0">
                    <motion.div layout className={cn("text-sm leading-6 whitespace-pre-wrap", expanded ? "" : "line-clamp-3")}>{m.text}</motion.div>
                  </CardContent>
                  <CardFooter className="p-3 pt-0 text-[11px] text-zinc-500">
                    时间 12:30 · ID {m.id}
                  </CardFooter>
                </Card>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Composer + 主行动 */}
      <div className="border-t border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea rows={1} placeholder="请向代理提问或发送指令…" className="flex-1 resize-y rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600" />
          <Button onClick={onRun} disabled={running} size="lg" className="gap-2">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {running ? "运行中" : "运行"}
          </Button>
        </div>
        <div className="mt-2 text-[11px] text-zinc-500">提示：按 Ctrl/⌘+Enter 快速运行。</div>
      </div>
    </>
  );
}

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const MOCK_EPISODES = [
  { id: "ep-001", title: "市场周报生成", status: "done", updatedAt: "3 分钟前" },
  { id: "ep-002", title: "北海旅游攻略", status: "running", updatedAt: "进行中" },
  { id: "ep-003", title: "法务条款润色", status: "failed", updatedAt: "23 分钟前" },
];

export function ConversationListPanel() {
  const [selectedEp, setSelectedEp] = useState("ep-002");

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 flex items-center gap-2">
        <div className="relative w-full">
          <Input placeholder="搜索会话…" className="pl-8" />
          <Search className="h-4 w-4 text-zinc-500 absolute left-2 top-2.5" />
        </div>
      </div>
      <div className="overflow-auto h-[calc(100%-48px)]">
        <AnimatePresence initial={false}>
          {MOCK_EPISODES.map((ep) => (
            <motion.div
              layout
              key={ep.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className={cn(
                "px-3 py-2 cursor-pointer border-b border-zinc-100 dark:border-zinc-800",
                ep.id === selectedEp
                  ? "bg-zinc-100/70 dark:bg-zinc-800/70"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
              )}
              onClick={() => setSelectedEp(ep.id)}
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium truncate">{ep.title}</div>
                <Badge
                  variant={
                    ep.status === "done"
                      ? "default"
                      : ep.status === "failed"
                      ? "destructive"
                      : "secondary"
                  }
                >
                  {ep.status}
                </Badge>
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">{ep.updatedAt}</div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

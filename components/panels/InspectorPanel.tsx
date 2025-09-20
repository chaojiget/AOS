import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Badge, Clock, Filter, Inbox, ChartPie } from "lucide-react";
import { SectionTitle } from "@/components/ui/SectionTitle";

const MOCK_EVENTS = [
  { id: "e1", ts: "12:30:01", level: "info", tool: "planner", title: "Plan generated (5 steps)" },
  { id: "e2", ts: "12:30:03", level: "info", tool: "web.search", title: "Query ‘北海 银滩 开放时间’" },
  { id: "e3", ts: "12:30:04", level: "warn", tool: "web.get", title: "Timeout, retry #1" },
  { id: "e4", ts: "12:30:07", level: "info", tool: "kb.lookup", title: "Fetched 12 docs" },
  { id: "e5", ts: "12:30:11", level: "info", tool: "writer", title: "Draft v2 composed (1.1k tokens)" },
];

function filterEventsByLevels(
  events: typeof MOCK_EVENTS,
  lvls: { info: boolean; warn: boolean; error: boolean }
) {
  return events.filter(
    (e) =>
      (e.level === "info" && lvls.info) ||
      (e.level === "warn" && lvls.warn) ||
      (e.level === "error" && lvls.error)
  );
}

export function InspectorPanel() {
  const [filters, setFilters] = useState({ info: true, warn: true, error: true });
  const filteredEvents = useMemo(() => filterEventsByLevels(MOCK_EVENTS, filters), [filters]);

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-zinc-200 dark:border-zinc-800">
        <SectionTitle icon={Activity} title="Inspector（运行检视）" extra={<Badge variant="outline">alpha</Badge>} />
      </div>
      {/* Filter bar */}
      <div className="px-3 py-2 flex items-center gap-3 text-xs border-b border-zinc-100 dark:border-zinc-800">
        <Filter className="h-4 w-4 text-zinc-500" />
        {(["info", "warn", "error"] as const).map((lvl) => (
          <label key={lvl} className="inline-flex items-center gap-1 select-none">
            <input
              type="checkbox"
              className="accent-zinc-900"
              checked={(filters as any)[lvl]}
              onChange={(e) => setFilters({ ...filters, [lvl]: e.target.checked })}
            />
            {lvl}
          </label>
        ))}
      </div>
      {/* Timeline */}
      <div className="flex-1 overflow-auto p-3 space-y-2">
        <AnimatePresence initial={false}>
          {filteredEvents.map((ev) => (
            <motion.div
              key={ev.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-2"
            >
              <div className="flex items-center justify-between text-xs text-zinc-500">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {ev.ts}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Inbox className="h-3.5 w-3.5" />
                  {ev.tool}
                </span>
              </div>
              <div className="mt-1 text-sm">{ev.title}</div>
            </motion.div>
          ))}
        </AnimatePresence>
        <div className="h-6" />
      </div>
      {/* Cost analysis placeholder */}
      <div className="border-top border-zinc-200 dark:border-zinc-800 p-3">
        <SectionTitle icon={ChartPie} title="成本统计（占位）" />
        <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          Tokens: 1.2k · 费用: $0.003 · 耗时: 1.8s
        </div>
      </div>
    </div>
  );
}

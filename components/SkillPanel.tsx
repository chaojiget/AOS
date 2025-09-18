import type { FC } from "react";

import {
  badgeClass,
  headingClass,
  inputSurfaceClass,
  insetSurfaceClass,
  labelClass,
  outlineButtonClass,
  subtleTextClass,
} from "../lib/theme";

export type SkillEvent =
  | {
      id: string;
      type: "tool";
      ts: string;
      name: string;
      status: "started" | "succeeded" | "failed";
      spanId?: string;
      argsSummary?: string;
      resultSummary?: string;
      cost?: number | null;
      latencyMs?: number | null;
      tokens?: number | null;
    }
  | {
      id: string;
      type: "note";
      ts: string;
      level?: string;
      text: string;
    };

export interface SkillPanelLabels {
  heading: string;
  filterPlaceholder: string;
  collapse: string;
  expand: string;
  empty: string;
  status: {
    started: string;
    succeeded: string;
    failed: string;
  };
  metricLabels: {
    latency: string;
    cost: string;
    tokens: string;
  };
  metrics: {
    cost: (value: number | null | undefined) => string;
    latency: (value: number | null | undefined) => string;
    tokens: (value: number | null | undefined) => string;
  };
  noteLabel: (level?: string) => string;
}

interface SkillPanelProps {
  events: SkillEvent[];
  filter: string;
  collapsed: boolean;
  onFilterChange: (value: string) => void;
  onToggleCollapse: () => void;
  labels: SkillPanelLabels;
}

const describeEvent = (event: SkillEvent): string => {
  if (event.type === "note") {
    return `${event.level ?? "note"} ${event.text}`.toLowerCase();
  }
  return [event.name, event.status, event.argsSummary, event.resultSummary, event.spanId]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
};

const SkillPanel: FC<SkillPanelProps> = ({
  events,
  filter,
  collapsed,
  onFilterChange,
  onToggleCollapse,
  labels,
}) => {
  const normalisedFilter = filter.trim().toLowerCase();
  const filteredEvents = normalisedFilter
    ? events.filter((event) => describeEvent(event).includes(normalisedFilter))
    : events;

  return (
    <section data-testid="skill-panel" className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className={headingClass}>{labels.heading}</h3>
        <button
          type="button"
          onClick={onToggleCollapse}
          className={`${outlineButtonClass} w-full sm:w-auto`}
          data-testid="skill-collapse-toggle"
        >
          {collapsed ? labels.expand : labels.collapse}
        </button>
      </header>

      {!collapsed ? (
        <div className="space-y-4">
          <label className="flex flex-col gap-2 text-sm">
            <span className={`${labelClass} text-slate-400`}>{labels.filterPlaceholder}</span>
            <input
              value={filter}
              onChange={(event) => onFilterChange(event.target.value)}
              placeholder={labels.filterPlaceholder}
              className={`${inputSurfaceClass} w-full`}
              data-testid="skill-filter-input"
            />
          </label>

          {filteredEvents.length === 0 ? (
            <p className={`${subtleTextClass} text-sm`}>{labels.empty}</p>
          ) : (
            <ul className="space-y-3" data-testid="skill-events">
              {filteredEvents.map((event) =>
                event.type === "tool" ? (
                  <li
                    key={event.id}
                    className={`${insetSurfaceClass} space-y-2 border-slate-800/60 p-4`}
                    data-kind="tool"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.18em]">
                      <span className={`${badgeClass} bg-sky-500/10 text-sky-100`}>
                        {event.name}
                      </span>
                      <span className={`${badgeClass} text-slate-300`}>
                        {labels.status[event.status] ?? event.status}
                      </span>
                      {event.spanId ? (
                        <span className={`${badgeClass} text-slate-300`}>span {event.spanId}</span>
                      ) : null}
                    </div>
                    {event.argsSummary ? (
                      <p className={`${subtleTextClass} text-xs`}>{event.argsSummary}</p>
                    ) : null}
                    {event.resultSummary ? (
                      <p className={`${subtleTextClass} text-xs`}>{event.resultSummary}</p>
                    ) : null}
                    <dl className="grid gap-2 text-[0.7rem] uppercase tracking-[0.18em] text-slate-300">
                      <div className="flex items-center gap-2">
                        <dt className={`${badgeClass} bg-transparent px-2 py-0`}>
                          {labels.metricLabels.latency}
                        </dt>
                        <dd>{labels.metrics.latency(event.latencyMs)}</dd>
                      </div>
                      <div className="flex items-center gap-2">
                        <dt className={`${badgeClass} bg-transparent px-2 py-0`}>
                          {labels.metricLabels.cost}
                        </dt>
                        <dd>{labels.metrics.cost(event.cost)}</dd>
                      </div>
                      <div className="flex items-center gap-2">
                        <dt className={`${badgeClass} bg-transparent px-2 py-0`}>
                          {labels.metricLabels.tokens}
                        </dt>
                        <dd>{labels.metrics.tokens(event.tokens)}</dd>
                      </div>
                    </dl>
                  </li>
                ) : (
                  <li
                    key={event.id}
                    className={`${insetSurfaceClass} space-y-2 border-amber-500/30 bg-amber-500/5 p-4`}
                    data-kind="note"
                  >
                    <div className={`${badgeClass} text-amber-200/90`}>
                      {labels.noteLabel(event.level)}
                    </div>
                    <p className="text-sm text-amber-100">{event.text}</p>
                    <p className={`${subtleTextClass} text-xs`}>
                      {new Date(event.ts).toLocaleString()}
                    </p>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
};

export default SkillPanel;

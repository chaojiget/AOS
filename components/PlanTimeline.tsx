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

export interface PlanTimelineStep {
  id: string;
  title: string;
  summary?: string;
}

export interface PlanTimelineEvent {
  id: string;
  ts: string;
  revision?: number;
  reason?: string;
  steps: PlanTimelineStep[];
}

export interface PlanTimelineLabels {
  heading: string;
  filterPlaceholder: string;
  collapse: string;
  expand: string;
  empty: string;
  updatedAt: (value: string) => string;
  revision: (value: number | undefined) => string;
  reason: (value: string | undefined) => string;
  stepCount: (count: number) => string;
}

interface PlanTimelineProps {
  events: PlanTimelineEvent[];
  filter: string;
  collapsed: boolean;
  onFilterChange: (value: string) => void;
  onToggleCollapse: () => void;
  labels: PlanTimelineLabels;
}

const formatTimestamp = (value: string): string => {
  if (!value) return "";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString();
  } catch {
    return value;
  }
};

const PlanTimeline: FC<PlanTimelineProps> = ({
  events,
  filter,
  collapsed,
  onFilterChange,
  onToggleCollapse,
  labels,
}) => {
  const normalisedFilter = filter.trim().toLowerCase();
  const filteredEvents = normalisedFilter
    ? events
        .map((event) => {
          const matchedSteps = event.steps.filter((step) => {
            const tokens = [step.id, step.title, step.summary]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();
            return tokens.includes(normalisedFilter);
          });
          const matchesMeta = [event.reason, formatTimestamp(event.ts)]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(normalisedFilter);
          return matchedSteps.length > 0 || matchesMeta
            ? { ...event, steps: matchedSteps.length > 0 ? matchedSteps : event.steps }
            : null;
        })
        .filter((value): value is PlanTimelineEvent => Boolean(value))
    : events;

  return (
    <section data-testid="plan-timeline" className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className={headingClass}>{labels.heading}</h3>
          <p className={`${subtleTextClass} text-xs`}>
            {labels.stepCount(events.reduce((count, evt) => count + evt.steps.length, 0))}
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleCollapse}
          className={`${outlineButtonClass} w-full sm:w-auto`}
          data-testid="plan-collapse-toggle"
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
              data-testid="plan-filter-input"
            />
          </label>

          {filteredEvents.length === 0 ? (
            <p className={`${subtleTextClass} text-sm`}>{labels.empty}</p>
          ) : (
            <ol className="space-y-4" data-testid="plan-events">
              {filteredEvents.map((event) => (
                <li
                  key={event.id}
                  className={`${insetSurfaceClass} space-y-3 border-slate-800/60 p-4`}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.18em]">
                    <span className={`${badgeClass} bg-sky-500/10 text-sky-100`}>
                      {labels.revision(event.revision)}
                    </span>
                    <span className={`${badgeClass} text-slate-300`}>
                      {labels.updatedAt(event.ts)}
                    </span>
                    {event.reason ? (
                      <span className={`${badgeClass} text-amber-200/90`}>
                        {labels.reason(event.reason)}
                      </span>
                    ) : null}
                  </div>
                  <ul className="space-y-2 text-sm">
                    {event.steps.map((step) => (
                      <li key={`${event.id}-${step.id}`} className="space-y-1">
                        <div className="font-semibold text-slate-100">{step.title}</div>
                        {step.summary ? (
                          <p className={`${subtleTextClass} text-xs`}>{step.summary}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </section>
  );
};

export default PlanTimeline;

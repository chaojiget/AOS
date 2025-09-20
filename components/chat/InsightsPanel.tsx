import type { FC } from "react";

import PlanTimeline, { type PlanTimelineEvent, type PlanTimelineLabels } from "../PlanTimeline";
import SkillPanel, { type SkillEvent, type SkillPanelLabels } from "../SkillPanel";
import {
  badgeClass,
  headingClass,
  insetSurfaceClass,
  labelClass,
  outlineButtonClass,
  panelSurfaceClass,
  primaryButtonClass,
  subtleTextClass,
} from "../../lib/theme";

interface GuardianBudgetSummary {
  limitLabel: string;
  limitValue: string;
  usedLabel: string;
  usedValue: string;
  remainingLabel: string;
  remainingValue: string;
  updatedAtText?: string | null;
}

interface GuardianAlertDisplay {
  id: string;
  message: string;
  severityLabel: string;
  severityToneClass: string;
  statusLabel: string;
  statusToneClass: string;
  timestamp: string;
  replayHref?: string | null;
  showApproval: boolean;
  isPending: boolean;
  onApprove: () => void;
  onReject: () => void;
  submittedText?: string;
  errorText?: string;
}

interface GuardianPanelProps {
  heading: string;
  subtitle: string;
  statusToneClass: string;
  statusLabel: string;
  errorText?: string | null;
  budget: GuardianBudgetSummary;
  alertsHeading: string;
  alertsCount: number;
  alertsEmptyText: string;
  alertsStreamErrorText?: string | null;
  alertsReplayLabel: string;
  alertsApproveLabel: string;
  alertsRejectLabel: string;
  alertsSubmittedLabel: string;
  alerts: GuardianAlertDisplay[];
}

interface RunStatItem {
  label: string;
  value: string;
}

interface RunStatsProps {
  title: string;
  statusToneClass: string;
  statusText: string;
  items: RunStatItem[];
  errorMessage?: string | null;
  noticeText: string;
}

interface RawResponseProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  collapseLabel: string;
  expandLabel: string;
  content: string;
  summary: string;
}

interface InsightsPanelProps {
  guardianPanel: GuardianPanelProps;
  runStats: RunStatsProps;
  rawResponse: RawResponseProps;
  planTimeline: {
    events: PlanTimelineEvent[];
    filter: string;
    collapsed: boolean;
    onFilterChange: (value: string) => void;
    onToggleCollapse: () => void;
    labels: PlanTimelineLabels;
  };
  skillPanel: {
    events: SkillEvent[];
    filter: string;
    collapsed: boolean;
    onFilterChange: (value: string) => void;
    onToggleCollapse: () => void;
    labels: SkillPanelLabels;
  };
}

const GuardianPanel: FC<GuardianPanelProps> = ({
  heading,
  subtitle,
  statusToneClass,
  statusLabel,
  errorText,
  budget,
  alertsHeading,
  alertsCount,
  alertsEmptyText,
  alertsStreamErrorText,
  alertsReplayLabel,
  alertsApproveLabel,
  alertsRejectLabel,
  alertsSubmittedLabel,
  alerts,
}) => (
  <section
    aria-labelledby="guardian-panel-title"
    className={`${panelSurfaceClass} space-y-6 p-6 sm:p-7`}
    data-testid="guardian-panel"
  >
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 id="guardian-panel-title" className={headingClass}>
            {heading}
          </h3>
          <p className={`${subtleTextClass} text-xs`}>{subtitle}</p>
        </div>
        <span className={`${badgeClass} ${statusToneClass} normal-case`}>{statusLabel}</span>
      </div>
      {errorText ? <p className="text-xs text-rose-200">{errorText}</p> : null}
      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <dt className={`${labelClass} text-slate-400`}>{budget.limitLabel}</dt>
          <dd className="text-sm text-slate-200">{budget.limitValue}</dd>
        </div>
        <div className="space-y-2">
          <dt className={`${labelClass} text-slate-400`}>{budget.usedLabel}</dt>
          <dd className="text-sm text-slate-200">{budget.usedValue}</dd>
        </div>
        <div className="space-y-2">
          <dt className={`${labelClass} text-slate-400`}>{budget.remainingLabel}</dt>
          <dd className="text-sm text-slate-200">{budget.remainingValue}</dd>
        </div>
      </dl>
      {budget.updatedAtText ? (
        <p className={`${subtleTextClass} text-xs`}>{budget.updatedAtText}</p>
      ) : null}
    </div>
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className={`${labelClass} text-slate-300`}>{alertsHeading}</h4>
        <span className={`${badgeClass} bg-slate-900/70 text-slate-300`}>{alertsCount}</span>
      </div>
      {alertsStreamErrorText ? (
        <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-100">
          {alertsStreamErrorText}
        </p>
      ) : null}
      {alerts.length === 0 ? (
        <p className={`${subtleTextClass} text-sm`}>{alertsEmptyText}</p>
      ) : (
        <ul className="space-y-3">
          {alerts.map((alert) => (
            <li
              key={alert.id}
              className={`${insetSurfaceClass} border border-slate-800/70 bg-slate-950/50 p-4`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <p className="text-sm text-slate-100">{alert.message}</p>
                  <div className="flex flex-wrap gap-2">
                    <span className={`${badgeClass} ${alert.severityToneClass}`}>
                      {alert.severityLabel}
                    </span>
                    <span className={`${badgeClass} ${alert.statusToneClass}`}>
                      {alert.statusLabel}
                    </span>
                  </div>
                  <p className={`${subtleTextClass} text-xs`}>{alert.timestamp}</p>
                </div>
                {alert.replayHref ? (
                  <a
                    href={alert.replayHref}
                    target="_blank"
                    rel="noreferrer"
                    className={`${outlineButtonClass} px-3 py-1.5 text-xs`}
                  >
                    {alertsReplayLabel}
                  </a>
                ) : null}
              </div>
              {alert.showApproval ? (
                <div className="flex flex-wrap gap-3 pt-3">
                  <button
                    type="button"
                    onClick={alert.onApprove}
                    disabled={alert.isPending}
                    className={`${primaryButtonClass} px-3 py-1.5 text-xs`}
                  >
                    {alertsApproveLabel}
                  </button>
                  <button
                    type="button"
                    onClick={alert.onReject}
                    disabled={alert.isPending}
                    className={`${outlineButtonClass} px-3 py-1.5 text-xs`}
                  >
                    {alertsRejectLabel}
                  </button>
                </div>
              ) : null}
              {alert.submittedText ? (
                <p className={`${subtleTextClass} pt-2 text-xs`}>{alert.submittedText}</p>
              ) : null}
              {alert.errorText ? (
                <p className="pt-2 text-xs text-rose-200">{alert.errorText}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  </section>
);

const RunStatsSection: FC<RunStatsProps> = ({
  title,
  statusToneClass,
  statusText,
  items,
  errorMessage,
  noticeText,
}) => (
  <section
    aria-labelledby="run-stats-title"
    className={`${panelSurfaceClass} space-y-6 p-6 sm:p-7`}
    data-testid="run-stats-panel"
  >
    <div className="flex items-center justify-between gap-3">
      <h3 id="run-stats-title" className={headingClass}>
        {title}
      </h3>
      <span className={`${badgeClass} ${statusToneClass} bg-transparent normal-case`}>
        {statusText}
      </span>
    </div>
    <dl className="grid gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="space-y-2">
          <dt className={`${labelClass} text-slate-400`}>{item.label}</dt>
          <dd className="text-sm text-slate-200">{item.value}</dd>
        </div>
      ))}
    </dl>
    {errorMessage ? (
      <p className="rounded-2xl border border-orange-500/50 bg-orange-500/10 px-4 py-3 text-sm text-orange-200">
        {errorMessage}
      </p>
    ) : (
      <p className={`${subtleTextClass} text-xs`}>{noticeText}</p>
    )}
  </section>
);

const RawResponseSection: FC<RawResponseProps> = ({
  title,
  isOpen,
  onToggle,
  collapseLabel,
  expandLabel,
  content,
  summary,
}) => (
  <section
    aria-labelledby="raw-response-title"
    className={`${panelSurfaceClass} space-y-4 p-6 sm:p-7`}
    data-testid="raw-response-panel"
  >
    <div className="flex items-center justify-between gap-3">
      <h3 id="raw-response-title" className={headingClass}>
        {title}
      </h3>
      <button
        type="button"
        onClick={onToggle}
        className={`${outlineButtonClass} px-3 py-1 text-xs`}
      >
        {isOpen ? collapseLabel : expandLabel}
      </button>
    </div>
    {isOpen ? (
      <pre className="max-h-[28rem] overflow-auto rounded-2xl border border-slate-800/70 bg-slate-950/60 p-4 text-xs leading-relaxed text-slate-200">
        {content}
      </pre>
    ) : (
      <p className={`${subtleTextClass} text-xs`}>{summary}</p>
    )}
  </section>
);

const InsightsPanel: FC<InsightsPanelProps> = ({
  guardianPanel,
  runStats,
  rawResponse,
  planTimeline,
  skillPanel,
}) => (
  <aside className="space-y-6" data-testid="chat-insights">
    <GuardianPanel {...guardianPanel} />
    <RunStatsSection {...runStats} />
    <RawResponseSection {...rawResponse} />
    <section className={`${panelSurfaceClass} space-y-6 p-6 sm:p-7`} data-testid="plan-panel">
      <PlanTimeline {...planTimeline} />
    </section>
    <section
      className={`${panelSurfaceClass} space-y-6 p-6 sm:p-7`}
      data-testid="skill-panel-wrapper"
    >
      <SkillPanel {...skillPanel} />
    </section>
  </aside>
);

export type {
  GuardianAlertDisplay,
  GuardianBudgetSummary,
  GuardianPanelProps,
  InsightsPanelProps,
  RawResponseProps,
  RunStatItem,
  RunStatsProps,
};

export default InsightsPanel;

import type { FC } from "react";

import {
  badgeClass,
  headingClass,
  labelClass,
  outlineButtonClass,
  panelSurfaceClass,
  primaryButtonClass,
  subtleTextClass,
} from "../../lib/theme";

interface SidebarProps {
  heading: string;
  traceNotice: string;
  traceId?: string | null;
  episodesLabel: string;
  downloadLabel: string;
  onSave: () => void;
  saveLabel: string;
  disableSave?: boolean;
  downloadHref?: string | null;
  draftLabel: string;
  draftInput?: string | null;
}

const Sidebar: FC<SidebarProps> = ({
  heading,
  traceNotice,
  traceId,
  episodesLabel,
  downloadLabel,
  onSave,
  saveLabel,
  disableSave,
  downloadHref,
  draftLabel,
  draftInput,
}) => {
  return (
    <aside className="space-y-6" data-testid="chat-sidebar">
      <section className={`${panelSurfaceClass} space-y-4 p-5 sm:p-6`}>
        <div className="space-y-1">
          <h3 className={headingClass}>{heading}</h3>
          <p className={`${subtleTextClass} text-xs sm:text-sm`}>{traceNotice}</p>
        </div>
        <div className="flex flex-col gap-3 text-xs sm:flex-row sm:items-center sm:justify-between sm:text-sm">
          {traceId ? (
            <span className="flex items-center gap-2 truncate text-sky-200">
              <span className={`${badgeClass} bg-sky-500/10 text-sky-100`}>{episodesLabel}</span>
              <span className="truncate text-slate-200">episodes/{traceId}.jsonl</span>
            </span>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {traceId && downloadHref ? (
              <a
                className={`${outlineButtonClass} px-3 py-1 text-xs sm:text-sm`}
                href={downloadHref}
              >
                {downloadLabel}
              </a>
            ) : null}
            <button
              type="button"
              onClick={onSave}
              disabled={disableSave}
              className={`${primaryButtonClass} px-3 py-1 text-xs sm:text-sm`}
            >
              {saveLabel}
            </button>
          </div>
        </div>
      </section>

      {draftInput ? (
        <section className={`${panelSurfaceClass} space-y-3 p-5 sm:p-6`}>
          <div className={`${labelClass} text-slate-400`}>{draftLabel}</div>
          <p className="whitespace-pre-wrap text-sm text-slate-200">{draftInput}</p>
        </section>
      ) : null}
    </aside>
  );
};

export default Sidebar;

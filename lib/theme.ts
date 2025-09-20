export const shellClass = "min-h-screen bg-slate-950 text-slate-100 theme-shell";

export const headerSurfaceClass =
  "border-b border-slate-800/70 bg-slate-900/70 shadow-[0_18px_45px_rgba(8,15,35,0.55)] backdrop-blur theme-header-surface";

export const pageContainerClass = "mx-auto w-full max-w-6xl px-6 pb-16 pt-10 sm:px-8";

export const panelSurfaceClass =
  "rounded-3xl border border-slate-800/80 bg-slate-900/60 shadow-[0_24px_60px_rgba(8,15,35,0.45)] theme-panel-surface";

export const insetSurfaceClass =
  "rounded-2xl border border-slate-800/70 bg-slate-950/60 shadow-inner shadow-slate-950/40 theme-inset-surface";

export const inputSurfaceClass =
  "rounded-2xl border border-slate-800/70 bg-slate-950/70 px-4 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 theme-input-surface";

export const pillGroupClass =
  "flex items-center gap-2 rounded-full border border-slate-800/70 bg-slate-900/60 p-1.5 text-sm theme-pill-group";

export const headingClass = "text-lg font-semibold leading-snug text-slate-100 theme-heading";

export const subtleTextClass = "text-sm text-slate-400 theme-subtle-text";

export const labelClass =
  "text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 theme-label";

export const badgeClass =
  "inline-flex items-center gap-1 rounded-full border border-slate-700/60 bg-slate-900/70 px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-slate-300 theme-badge";

export const primaryButtonClass =
  "inline-flex items-center justify-center rounded-full bg-sky-400 px-5 py-2 text-sm font-semibold text-slate-950 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 enabled:hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-60";

export const outlineButtonClass =
  "inline-flex items-center justify-center rounded-full border border-sky-400/70 px-5 py-2 text-sm font-semibold text-sky-200 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 enabled:hover:border-sky-300 enabled:hover:text-sky-100 disabled:cursor-not-allowed disabled:opacity-50";

export const modalBackdropClass =
  "fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm transition-opacity";

export const modalSurfaceClass =
  "z-50 w-full max-w-lg rounded-3xl border border-slate-800/70 bg-slate-900/70 p-6 shadow-[0_30px_90px_rgba(8,15,35,0.65)]";

export type ChatRoleTone = "user" | "assistant" | "system";

export const chatBubbleVariants: Record<
  ChatRoleTone,
  {
    group: string;
    article: string;
    label: string;
    meta: string;
  }
> = {
  user: {
    group: "items-end text-right",
    article:
      "self-end bg-sky-400 text-slate-950 ring-1 ring-inset ring-sky-300/70 shadow-lg shadow-sky-900/30",
    label: "border-sky-300/60 bg-sky-400/20 text-sky-100",
    meta: "text-slate-900/70",
  },
  assistant: {
    group: "items-start text-left",
    article:
      "self-start bg-slate-800 text-slate-100 ring-1 ring-inset ring-slate-700/70 shadow-lg shadow-slate-950/40",
    label: "border-slate-700 bg-slate-800 text-slate-200",
    meta: "text-slate-300/80",
  },
  system: {
    group: "items-center text-center",
    article:
      "self-center bg-slate-900 text-slate-100 ring-1 ring-inset ring-slate-800/80 shadow-lg shadow-slate-950/40",
    label: "border-slate-700 bg-slate-900 text-slate-200",
    meta: "text-slate-300/80",
  },
};

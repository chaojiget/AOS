import { memo } from "react";

export type RunIndicatorState = "idle" | "running" | "error";

interface RunStatusIndicatorProps {
  state: RunIndicatorState;
  label: string;
  size?: "sm" | "md";
  className?: string;
  "data-testid"?: string;
}

const STATE_STYLES: Record<RunIndicatorState, { container: string; dot: string }> = {
  idle: {
    container: "border border-slate-600 bg-slate-800 text-slate-100",
    dot: "bg-slate-200",
  },
  running: {
    container: "border border-emerald-600 bg-emerald-500 text-emerald-950",
    dot: "bg-emerald-900/80",
  },
  error: {
    container: "border border-rose-400 bg-rose-500 text-rose-50",
    dot: "bg-rose-100",
  },
};

const SIZE_STYLES: Record<
  NonNullable<RunStatusIndicatorProps["size"]>,
  { container: string; dot: string }
> = {
  sm: {
    container: "text-xs px-2.5 py-1",
    dot: "h-2 w-2",
  },
  md: {
    container: "text-sm px-3 py-1.5",
    dot: "h-2.5 w-2.5",
  },
};

const RunStatusIndicatorComponent = ({
  state,
  label,
  size = "md",
  className,
  "data-testid": dataTestId,
}: RunStatusIndicatorProps) => {
  const palette = STATE_STYLES[state];
  const sizeTokens = SIZE_STYLES[size];

  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-2 rounded-full font-semibold leading-none ${palette.container} ${sizeTokens.container} ${className ?? ""}`.trim()}
      data-testid={dataTestId}
    >
      <span
        aria-hidden="true"
        className={`inline-flex ${sizeTokens.dot} rounded-full ${palette.dot}`}
      />
      {label}
    </span>
  );
};

export const RunStatusIndicator = memo(RunStatusIndicatorComponent);

export default RunStatusIndicator;

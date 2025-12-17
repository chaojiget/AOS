export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms)) return "-";
  if (ms >= 3_600_000) {
    const totalMinutes = Math.floor(ms / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes ? `${hours}h${minutes}m` : `${hours}h`;
  }
  if (ms >= 60_000) {
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.floor((ms - minutes * 60_000) / 1000);
    return seconds ? `${minutes}m${seconds}s` : `${minutes}m`;
  }
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 2)}s`;
  return `${Math.round(ms)}ms`;
}

export function niceStepMs(targetMs: number): number {
  if (!Number.isFinite(targetMs) || targetMs <= 0) return 1000;
  const power = Math.pow(10, Math.floor(Math.log10(targetMs)));
  const candidates = [1, 2, 5, 10].map((n) => n * power);
  for (const c of candidates) {
    if (c >= targetMs) return c;
  }
  return 10 * power;
}

export function formatTickLabel(ms: number): string {
  if (ms >= 3_600_000) return `${(ms / 3_600_000).toFixed(ms >= 36_000_000 ? 0 : 1)}h`;
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(ms >= 600_000 ? 0 : 1)}m`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s`;
  return `${Math.round(ms)}ms`;
}

import type { DeepTraceSpan } from "@/lib/deep-trace";

export function kindColor(
  kind: DeepTraceSpan["kind"],
  status: DeepTraceSpan["status"],
): string {
  const base =
    kind === "LLM"
      ? "bg-emerald-500/20 border-emerald-400/40"
      : kind === "RETRIEVAL"
        ? "bg-sky-500/20 border-sky-400/40"
        : kind === "TOOL"
          ? "bg-fuchsia-500/20 border-fuchsia-400/40"
          : "bg-white/10 border-white/15";

  if (status === "error") return `${base} ring-1 ring-red-400/40`;
  return base;
}

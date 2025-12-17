import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function Badge({
  className,
  variant = "default",
  children,
}: {
  className?: string;
  variant?: "default" | "error" | "warn" | "info";
  children: ReactNode;
}) {
  const variants: Record<NonNullable<typeof variant>, string> = {
    default: "bg-white/10 text-zinc-200",
    error: "bg-red-500/20 text-red-200",
    warn: "bg-amber-500/20 text-amber-200",
    info: "bg-sky-500/20 text-sky-200",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-white/10 px-2 py-0.5 text-xs font-medium",
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

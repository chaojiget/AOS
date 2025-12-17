import * as React from "react";

import { cn } from "@/lib/utils";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  variant?: "default" | "secondary" | "ghost";
};

export function Button({
  asChild,
  className,
  variant = "default",
  children,
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:pointer-events-none disabled:opacity-60";
  const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
    default: "bg-white/10 text-white hover:bg-white/20",
    secondary: "bg-black/30 text-white hover:bg-black/40 border border-white/10",
    ghost: "bg-transparent text-zinc-200 hover:bg-white/10",
  };

  const mergedClassName = cn(base, variants[variant], "px-3 py-2", className);

  if (asChild) {
    const child = React.Children.only(children) as React.ReactElement<{ className?: string }>;
    return React.cloneElement(child, { className: cn(mergedClassName, child.props.className) });
  }

  return (
    <button className={mergedClassName} {...props}>
      {children}
    </button>
  );
}

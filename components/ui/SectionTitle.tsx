import React from "react";

export function SectionTitle({ icon: Icon, title, extra }: { icon?: any; title: string; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm font-medium text-zinc-600 dark:text-zinc-300">
        {Icon && <Icon className="h-4 w-4" />}<span>{title}</span>
      </div>
      {extra}
    </div>
  );
}

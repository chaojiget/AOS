import type { FC, ReactNode } from "react";

import { headingClass, insetSurfaceClass, subtleTextClass } from "../lib/theme";

interface ErrorCardAction {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
}

interface ErrorCardProps {
  title: string;
  description?: string;
  actions?: ErrorCardAction[];
  className?: string;
  "data-testid"?: string;
}

const ErrorCard: FC<ErrorCardProps> = ({
  title,
  description,
  actions = [],
  className,
  "data-testid": dataTestId,
}) => {
  return (
    <section
      className={`${insetSurfaceClass} space-y-3 border border-rose-500/30 bg-rose-500/5 p-4 text-left ${className ?? ""}`}
      data-testid={dataTestId}
      role="alert"
    >
      <h3 className={`${headingClass} text-base text-rose-100`}>{title}</h3>
      {description ? (
        <p className={`${subtleTextClass} text-sm text-rose-200/90`}>{description}</p>
      ) : null}
      {actions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {actions.map((action, index) => (
            <button
              key={index}
              type="button"
              onClick={action.onClick}
              className="inline-flex items-center gap-2 rounded-full border border-rose-300/60 px-4 py-1.5 text-sm font-semibold text-rose-100 transition hover:border-rose-200 hover:text-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-200"
            >
              {action.icon ? <span aria-hidden>{action.icon}</span> : null}
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
};

export interface ErrorCardHandle {
  focus: () => void;
}

export default ErrorCard;

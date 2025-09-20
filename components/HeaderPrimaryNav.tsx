import Link from "next/link";
import { memo } from "react";

export interface HeaderPrimaryNavItem {
  href: string;
  label: string;
  isActive?: boolean;
}

interface HeaderPrimaryNavProps {
  items: HeaderPrimaryNavItem[];
  className?: string;
  "data-testid"?: string;
  ariaLabel: string;
}

const HeaderPrimaryNavComponent = ({
  items,
  className,
  ariaLabel,
  "data-testid": dataTestId,
}: HeaderPrimaryNavProps) => {
  if (!items.length) {
    return null;
  }

  return (
    <nav aria-label={ariaLabel} className={className} data-testid={dataTestId}>
      <ul className="flex flex-wrap items-center justify-center gap-2">
        {items.map((item) => {
          const baseClassName =
            "inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400";
          const stateClassName = item.isActive
            ? "bg-sky-400 text-slate-950 shadow-[0_12px_30px_rgba(56,189,248,0.35)]"
            : "text-slate-300 theme-text-muted hover:bg-slate-800/60 hover:text-slate-100";

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={item.isActive ? "page" : undefined}
                className={`${baseClassName} ${stateClassName}`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export const HeaderPrimaryNav = memo(HeaderPrimaryNavComponent);

export default HeaderPrimaryNav;

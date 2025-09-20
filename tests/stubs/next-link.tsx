import type { AnchorHTMLAttributes, PropsWithChildren } from "react";
import React from "react";

type Href = string | { pathname?: string };

type LinkProps = PropsWithChildren<AnchorHTMLAttributes<HTMLAnchorElement> & { href: Href }>;

export default function Link({ href, children, ...rest }: LinkProps) {
  const url = typeof href === "string" ? href : href?.pathname ?? "";
  return (
    <a {...rest} href={url}>
      {children}
    </a>
  );
}

import type { AnchorHTMLAttributes, PropsWithChildren } from "react";
import React from "react";

type Href = string | { pathname?: string };

type LinkProps = PropsWithChildren<
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: Href }
>;

export default function Link({ href, children, ...rest }: LinkProps) {
  let url = "";

  if (typeof href === "string") {
    url = href;
  } else if (href && typeof href === "object") {
    url = href.pathname ?? "";
  }

  return (
    <a {...rest} href={url}>
      {children}
    </a>
  );
}

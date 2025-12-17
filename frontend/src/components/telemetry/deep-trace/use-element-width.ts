"use client";

import * as React from "react";

export function useElementClientWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = React.useState(0);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => setWidth(el.clientWidth);
    update();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }

    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return width;
}

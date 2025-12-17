"use client";

import * as React from "react";

export function useRafState<T>(initial: T): [T, (next: T) => void] {
  const [state, setState] = React.useState(initial);
  const frame = React.useRef<number | null>(null);
  const pending = React.useRef<T>(initial);

  const set = React.useCallback((next: T) => {
    pending.current = next;
    if (frame.current != null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setState(pending.current);
    });
  }, []);

  React.useEffect(
    () => () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return [state, set];
}

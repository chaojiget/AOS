import { useState, useEffect } from "react";

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function getGridTemplateColumns(l: number, r: number) {
  return `${l}px 1fr ${r}px`;
}

export function useResizer(initialLeft = 280, initialRight = 360) {
  const [left, setLeft] = useState(initialLeft);
  const [right, setRight] = useState(initialRight);
  const [drag, setDrag] = useState<"left" | "right" | null>(null);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!drag) return;
      if (drag === "left") setLeft(clamp(e.clientX, 220, 520));
      if (drag === "right") {
        const vw = window.innerWidth;
        setRight(clamp(vw - e.clientX, 280, 560));
      }
    }
    function onUp() {
      setDrag(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag]);

  return { left, right, drag, setDrag };
}

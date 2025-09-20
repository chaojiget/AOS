import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { type LocalToastTone, useLocalToast } from "../components/useLocalToast";

const Harness: React.FC<{ tone?: LocalToastTone }> = ({ tone = "error" }) => {
  const { ToastContainer } = useLocalToast({
    title: "Notice",
    message: "Test message",
    dismissLabel: "Close",
    actionLabel: "Retry",
    onAction: () => {},
    tone,
  });
  return <ToastContainer />;
};

describe("useLocalToast", () => {
  it("renders toast markup with title, message and action", () => {
    const html = renderToStaticMarkup(<Harness />);

    expect(html.includes("Notice")).toBe(true);
    expect(html.includes("Test message")).toBe(true);
    expect(html.includes("Retry")).toBe(true);
    expect(html.includes('data-tone="error"')).toBe(true);
  });

  it("applies tone specific styles", () => {
    const html = renderToStaticMarkup(<Harness tone="success" />);

    expect(html.includes('data-tone="success"')).toBe(true);
    expect(html.includes("border-emerald-500/40")).toBe(true);
  });
});

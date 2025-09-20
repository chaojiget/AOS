import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import HomePage from "../pages/index";
import { I18nProvider } from "../lib/i18n/index";

describe("HomePage internationalisation", () => {
  it("renders Chinese copy by default", () => {
    const html = renderToStaticMarkup(
      <I18nProvider locale="zh-CN">
        <HomePage />
      </I18nProvider>,
    );

    expect(html.includes("AgentOS · 对话与日志流")).toBe(true);
    expect(html.includes("保存对话")).toBe(true);
    expect(html.includes("聊天输入")).toBe(true);
    expect(html.includes("提示：按 Ctrl+Enter 或 ⌘+Enter 快速运行。")).toBe(true);
    expect(html.includes('aria-keyshortcuts="Control+Enter Meta+Enter"')).toBe(true);
    expect(html.includes("disabled")).toBe(true);
    expect(html.includes("Guardian 守护")).toBe(true);
    expect(html.includes("告警列表")).toBe(true);
  });

  it("renders English copy when locale changes", () => {
    const html = renderToStaticMarkup(
      <I18nProvider locale="en">
        <HomePage />
      </I18nProvider>,
    );

    expect(html.includes("AgentOS · Chat + LogFlow")).toBe(true);
    expect(html.includes("Save conversation")).toBe(true);
    expect(html.includes("Chat input")).toBe(true);
    expect(html.includes("Tip: Press Ctrl+Enter or ⌘+Enter to run the agent.")).toBe(true);
    expect(html.includes('aria-keyshortcuts="Control+Enter Meta+Enter"')).toBe(true);
    expect(html.includes("Guardian oversight")).toBe(true);
    expect(html.includes("Active alerts")).toBe(true);
  });
});

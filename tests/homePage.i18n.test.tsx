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
  });
});

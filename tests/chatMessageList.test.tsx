import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ChatMessageList, { type ChatHistoryMessage } from "../components/ChatMessageList";
import { I18nProvider } from "../lib/i18n/index";

describe("ChatMessageList", () => {
  it("renders multi-turn conversation bubbles with status", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2023-06-01T00:00:05Z"));
    const messages: ChatHistoryMessage[] = [
      {
        id: "u-1",
        role: "user",
        content: "Hello",
        ts: new Date("2023-06-01T00:00:00Z").toISOString(),
        status: "done",
        msgId: "msg-user-1",
      },
      {
        id: "a-1",
        role: "assistant",
        content: "Hi, how can I help?",
        ts: new Date("2023-06-01T00:00:01Z").toISOString(),
        status: "done",
        msgId: "msg-assistant-1",
        latencyMs: 1200,
        cost: 0.0042,
        traceId: "trace-123",
      },
      {
        id: "u-2",
        role: "user",
        content: "Tell me a joke.",
        ts: new Date("2023-06-01T00:00:02Z").toISOString(),
        status: "pending",
      },
    ];

    const html = renderToStaticMarkup(
      <I18nProvider locale="zh-CN">
        <ChatMessageList messages={messages} isRunning />
      </I18nProvider>,
    );

    expect(html.includes('data-group-role="user"')).toBe(true);
    expect(html.includes('data-group-role="assistant"')).toBe(true);
    expect(html.includes('data-status="pending"')).toBe(true);
    expect(html.includes('data-msg-id="msg-assistant-1"')).toBe(true);
    expect(html.includes('id="chat-message-a-1"')).toBe(true);
    expect(html.includes("Hello")).toBe(true);
    expect(html.includes("Hi, how can I help?")).toBe(true);
    expect(html.includes("Tell me a joke.")).toBe(true);
    expect(html.includes("<details")).toBe(true);
    expect(html.includes("<details open")).toBe(false);
    expect(html.includes("查看消息详情")).toBe(true);
    expect(html.includes("延迟")).toBe(true);
    expect(html.includes("1200 ms")).toBe(true);
    expect(html.includes("成本")).toBe(true);
    expect(html.includes("0.0042")).toBe(true);
    expect(html.includes("msg-user…")).toBe(true);
    expect(html.includes("msg-assistant…")).toBe(true);
    expect(html.includes("秒前")).toBe(true);
    expect(html.includes('data-role="status"')).toBe(true);
    expect(html.includes("正在生成回复…")).toBe(true);
    vi.useRealTimers();
  });

  it("renders english labels when locale is en", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2023-06-01T00:00:05Z"));
    const messages: ChatHistoryMessage[] = [
      {
        id: "u-1",
        role: "user",
        content: "你好",
        ts: new Date("2023-06-01T00:00:00Z").toISOString(),
        status: "done",
        msgId: "msg-user-1",
      },
    ];

    const html = renderToStaticMarkup(
      <I18nProvider locale="en">
        <ChatMessageList messages={messages} />
      </I18nProvider>,
    );

    expect(html.includes("View message details")).toBe(true);
    expect(html.includes("msg_id")).toBe(true);
    expect(html.includes("msg-user…")).toBe(true);
    expect(html.includes("Delivered")).toBe(true);
    expect(html.includes("No messages yet.")).toBe(false);
    vi.useRealTimers();
  });

  it("highlights failed assistant messages with review metadata", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2023-06-01T00:00:05Z"));
    const messages: ChatHistoryMessage[] = [
      {
        id: "u-1",
        role: "user",
        content: "ping",
        ts: new Date("2023-06-01T00:00:00Z").toISOString(),
        status: "done",
        msgId: "msg-user-1",
      },
      {
        id: "a-err",
        role: "assistant",
        content: "tool invocation failed",
        ts: new Date("2023-06-01T00:00:01Z").toISOString(),
        status: "error",
        msgId: "msg-assistant-err",
        error: "tool invocation failed",
        failureReason: "max-iterations",
        reviewNotes: ["tool invocation failed"],
      },
    ];

    const html = renderToStaticMarkup(
      <I18nProvider locale="en">
        <ChatMessageList messages={messages} />
      </I18nProvider>,
    );

    expect(html.includes('data-status="error"')).toBe(true);
    expect(html.includes("tool invocation failed")).toBe(true);
    expect(html.includes("reason")).toBe(true);
    expect(html.includes("max-iterations")).toBe(true);
    expect(html.includes("review notes")).toBe(true);
    vi.useRealTimers();
  });
});

import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ChatMessageList, { type ChatHistoryMessage } from "../components/ChatMessageList";

describe("ChatMessageList", () => {
  it("renders multi-turn conversation bubbles with status", () => {
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

    const html = renderToStaticMarkup(<ChatMessageList messages={messages} isRunning />);

    expect(html.includes('data-group-role="user"')).toBe(true);
    expect(html.includes('data-group-role="assistant"')).toBe(true);
    expect(html.includes('data-status="pending"')).toBe(true);
    expect(html.includes('data-msg-id="msg-assistant-1"')).toBe(true);
    expect(html.includes("Hello")).toBe(true);
    expect(html.includes("Hi, how can I help?")).toBe(true);
    expect(html.includes("Tell me a joke.")).toBe(true);
    expect(html.includes("latency · 1200 ms")).toBe(true);
    expect(html.includes("cost · 0.0042")).toBe(true);
    expect(html.includes('data-role="status"')).toBe(true);
  });
});

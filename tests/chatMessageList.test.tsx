import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ChatMessageList from "../components/ChatMessageList";

describe("ChatMessageList", () => {
  it("renders multi-turn conversation bubbles with status", () => {
    const html = renderToStaticMarkup(
      <ChatMessageList
        messages={[
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi, how can I help?" },
          { role: "user", content: "Tell me a joke." },
        ]}
        isRunning
      />,
    );

    expect(html.includes('data-role="user"')).toBe(true);
    expect(html.includes('data-role="assistant"')).toBe(true);
    expect(html.includes("Hello")).toBe(true);
    expect(html.includes("Hi, how can I help?")).toBe(true);
    expect(html.includes("Tell me a joke.")).toBe(true);
    expect(html.includes('data-role="status"')).toBe(true);
  });
});

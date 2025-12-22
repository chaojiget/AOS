"use client";

import * as React from "react";

import { HttpAgent, type AgentSubscriber, randomUUID } from "@ag-ui/client";
import type { Message } from "@ag-ui/core";

import { backendBaseUrl } from "@/lib/api";

export type AgUiChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type UseAgUiChatState = {
  messages: AgUiChatMessage[];
  input: string;
  setInput: (value: string) => void;
  isRunning: boolean;
  error: string | null;
  send: () => Promise<void>;
  abort: () => void;
};

function toAgUiMessage(m: AgUiChatMessage): Message {
  return { id: m.id, role: m.role, content: m.content };
}

export function useAgUiChat(): UseAgUiChatState {
  const [messages, setMessages] = React.useState<AgUiChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [isRunning, setIsRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const agentRef = React.useRef<HttpAgent | null>(null);

  const getAgent = React.useCallback(() => {
    if (agentRef.current) return agentRef.current;

    const url = `${backendBaseUrl()}/api/v1/ag-ui`;
    const agent = new HttpAgent({ url });
    agentRef.current = agent;
    return agent;
  }, []);

  const send = React.useCallback(async () => {
    const text = input.trim();
    if (!text || isRunning) return;

    setError(null);
    setIsRunning(true);

    const userMsg: AgUiChatMessage = { id: `user-${randomUUID()}`, role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    const agent = getAgent();

    // Capture streaming deltas into a single assistant message.
    const assistantId = `assistant-${randomUUID()}`;
    let buffer = "";

    const subscriber: AgentSubscriber = {
      onTextMessageStartEvent: () => {
        buffer = "";
        setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);
      },
      onTextMessageContentEvent: ({ event, textMessageBuffer }) => {
        // Prefer the library-computed buffer when available.
        buffer = textMessageBuffer ?? (buffer + (event.delta ?? ""));
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: buffer } : m)),
        );
      },
      onRunErrorEvent: ({ event }) => {
        setError(event.message ?? "Agent error");
      },
    };

    try {
      agent.setMessages([...messages, userMsg].map(toAgUiMessage));
      await agent.runAgent(
        {
          runId: `run-${randomUUID()}`,
          forwardedProps: { channel: "aos-ui" },
          tools: [],
          context: [],
        },
        subscriber,
      );

      // Ensure we always have a trace id in logs by letting the agent add it.
      // (The server wrapper will append `trace_id:` in the final content.)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  }, [getAgent, input, isRunning, messages]);

  const abort = React.useCallback(() => {
    agentRef.current?.abortRun();
    setIsRunning(false);
  }, []);

  return {
    messages,
    input,
    setInput,
    isRunning,
    error,
    send,
    abort,
  };
}

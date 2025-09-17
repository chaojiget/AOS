import { FormEventHandler, useCallback, useMemo, useState } from "react";
import type { NextPage } from "next";
import ChatMessageList, { type ChatHistoryMessage } from "../components/ChatMessageList";
import LogFlowPanel from "../components/LogFlowPanel";

interface ChatSendResponse {
  trace_id?: string;
  msg_id?: string;
  message?: {
    msg_id?: string;
    role?: string;
    content?: string;
    text?: string;
    ts?: string;
    trace_id?: string;
  };
  result?: { text?: string; msg_id?: string; ts?: string };
  output?: { text?: string; msg_id?: string; ts?: string };
  final?: { text?: string; msg_id?: string; ts?: string };
  metrics?: { latency_ms?: number; cost?: number };
  error?: { message?: string } | null;
  message_error?: string;
}

const generateLocalId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
};

const serialiseHistoryForRequest = (messages: ChatHistoryMessage[]) =>
  messages.map((message) => ({
    role: message.role,
    content: message.content,
    msg_id: message.msgId,
    id: message.id,
    ts: message.ts,
  }));

const HomePage: NextPage = () => {
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [traceId, setTraceId] = useState<string | undefined>(undefined);
  const [latestResponse, setLatestResponse] = useState<any>(null);
  const [chatHistory, setChatHistory] = useState<ChatHistoryMessage[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"chat" | "logflow">("chat");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [cost, setCost] = useState<number | null>(null);

  const handleRun = useCallback(async () => {
    if (isRunning) return;
    const prompt = input.trim();
    if (!prompt) return;

    const createdAt = new Date().toISOString();
    const localId = generateLocalId();
    const userMessage: ChatHistoryMessage = {
      id: localId,
      role: "user",
      content: prompt,
      ts: createdAt,
      status: "pending",
      traceId,
    };

    const historyForRequest = [...chatHistory, userMessage];

    setChatHistory(historyForRequest);
    setIsRunning(true);
    setRunError(null);
    const previousTraceId = traceId;
    setTraceId(undefined);
    setLatestResponse(null);
    setLatencyMs(null);
    setCost(null);
    setInput("");
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      const response = await fetch("/api/chat.send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: prompt,
          trace_id: traceId,
          history: serialiseHistoryForRequest(historyForRequest),
        }),
      });
      const data: ChatSendResponse | null = await response.json().catch(() => null);
      if (!response.ok || !data || data.error || data.message_error) {
        const errorMessage =
          (data?.error as { message?: string } | undefined)?.message ??
          data?.message_error ??
          data?.message?.content ??
          `Request failed (${response.status})`;
        throw new Error(errorMessage);
      }
      setLatestResponse(data);
      const resolvedTraceId = data.trace_id ?? data.message?.trace_id ?? previousTraceId ?? traceId;
      setTraceId(resolvedTraceId);

      const computedLatency = data.metrics?.latency_ms ??
        (typeof performance !== "undefined" ? Math.round(performance.now() - startedAt) : Date.now() - startedAt);
      const computedCost = data.metrics?.cost ?? null;
      setLatencyMs(typeof computedLatency === "number" ? computedLatency : null);
      setCost(typeof computedCost === "number" ? computedCost : null);

      const assistantPayload = (data.message ?? data.result ?? data.output ?? data.final ?? {}) as {
        content?: string;
        text?: string;
        msg_id?: string;
        ts?: string;
        trace_id?: string;
      };
      const assistantContentRaw =
        typeof assistantPayload.content === "string"
          ? assistantPayload.content
          : typeof assistantPayload.text === "string"
            ? assistantPayload.text
            : assistantPayload && typeof assistantPayload === "object"
              ? JSON.stringify(assistantPayload)
              : "";
      const assistantContent =
        typeof assistantContentRaw === "string" && assistantContentRaw.length > 0
          ? assistantContentRaw
          : "";
      const assistantMsgId = assistantPayload.msg_id ?? data.msg_id ?? generateLocalId();
      const assistantTs = assistantPayload.ts ?? new Date().toISOString();

      setChatHistory((history) => {
        const updatedHistory: ChatHistoryMessage[] = history.map((message) =>
          message.id === localId
            ? {
                ...message,
                msgId: data.msg_id ?? message.msgId,
                traceId: resolvedTraceId,
                status: "done" as const,
              }
            : message,
        );
        const assistantMessage: ChatHistoryMessage = {
          id: assistantMsgId ?? generateLocalId(),
          msgId: assistantMsgId,
          role: "assistant",
          content: assistantContent,
          ts: assistantTs,
          status: "done" as const,
          traceId: resolvedTraceId,
          latencyMs: typeof computedLatency === "number" ? computedLatency : null,
          cost: typeof computedCost === "number" ? computedCost : null,
        };
        return [...updatedHistory, assistantMessage];
      });
    } catch (err: any) {
      const errorMessage = err?.message ?? "Failed to run agent";
      setRunError(errorMessage);
      setChatHistory((history) => {
        const updated = history.map((message) =>
          message.id === localId
            ? {
                ...message,
                status: "error" as const,
                error: errorMessage,
              }
            : message,
        );
        return [
          ...updated,
          {
            id: generateLocalId(),
            role: "system",
            content: `Error: ${errorMessage}`,
            ts: new Date().toISOString(),
            status: "error" as const,
            error: errorMessage,
          },
        ];
      });
      setTraceId(previousTraceId);
    } finally {
      setIsRunning(false);
    }
  }, [input, isRunning, chatHistory, traceId]);

  const handleSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    (event) => {
      event.preventDefault();
      void handleRun();
    },
    [handleRun],
  );

  const tabItems = useMemo(
    () => [
      { id: "chat" as const, label: "Chat" },
      { id: "logflow" as const, label: "LogFlow" },
    ],
    [],
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0f172a", color: "#e2e8f0" }}>
      <header
        style={{
          padding: "1.5rem 2rem",
          background: "#1e293b",
          boxShadow: "0 1px 12px rgba(0,0,0,0.4)",
        }}
      >
        <h1 style={{ margin: 0 }}>AgentOS · Chat + LogFlow</h1>
        <p style={{ margin: "0.25rem 0 0", fontSize: "0.95rem", color: "#94a3b8" }}>
          Submit a prompt to run the local agent, inspect timeline events, and explore task
          branches.
        </p>
      </header>

      <main
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "2rem",
          display: "grid",
          gap: "1.5rem",
        }}
      >
        <nav
          aria-label="Primary"
          style={{
            display: "flex",
            gap: "0.5rem",
            background: "#1e293b",
            borderRadius: 12,
            padding: "0.5rem",
          }}
        >
          {tabItems.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-pressed={selected}
                style={{
                  flex: 1,
                  padding: "0.75rem 1rem",
                  borderRadius: 10,
                  border: "none",
                  background: selected ? "#38bdf8" : "transparent",
                  color: selected ? "#0f172a" : "#e2e8f0",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "background 0.2s ease",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {activeTab === "chat" ? (
          <section
            style={{
              background: "#1e293b",
              borderRadius: 12,
              padding: "1.5rem",
              boxShadow: "inset 0 0 0 1px rgba(148,163,184,0.15)",
              display: "grid",
              gap: "1.5rem",
            }}
          >
            <div>
              <h3 style={{ margin: "0 0 0.75rem" }}>Conversation</h3>
              <ChatMessageList messages={chatHistory} isRunning={isRunning} />
            </div>
            <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1rem" }}>
              <label htmlFor="prompt" style={{ fontWeight: 600 }}>
                Chat Input
              </label>
              <textarea
                id="prompt"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void handleRun();
                  }
                }}
                placeholder="Ask the agent for a summary or instruction..."
                style={{
                  width: "100%",
                  minHeight: 140,
                  padding: "1rem",
                  borderRadius: 8,
                  border: "1px solid #334155",
                  background: "#0f172a",
                  color: "inherit",
                  fontSize: "1rem",
                }}
              />
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.75rem",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: "0.75rem",
                    padding: "0.75rem 1rem",
                    borderRadius: 10,
                    background: "#0f172a",
                    border: "1px solid #1f2937",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: "0.75rem", color: "#64748b", textTransform: "uppercase" }}>
                      trace_id
                    </span>
                    <span style={{ fontSize: "0.9rem" }}>{traceId ?? "-"}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: "0.75rem", color: "#64748b", textTransform: "uppercase" }}>
                      latency
                    </span>
                    <span style={{ fontSize: "0.9rem" }}>
                      {typeof latencyMs === "number" ? `${latencyMs.toFixed(0)} ms` : "-"}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: "0.75rem", color: "#64748b", textTransform: "uppercase" }}>
                      cost
                    </span>
                    <span style={{ fontSize: "0.9rem" }}>
                      {typeof cost === "number" ? cost.toFixed(4) : "-"}
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                  <button
                    type="submit"
                    disabled={isRunning}
                    style={{
                      padding: "0.75rem 1.5rem",
                      borderRadius: 999,
                      border: "none",
                      background: isRunning ? "#475569" : "#38bdf8",
                      color: "#0f172a",
                      fontWeight: 600,
                      cursor: isRunning ? "not-allowed" : "pointer",
                    }}
                  >
                    {isRunning ? "Running…" : "Run"}
                  </button>
                  <span style={{ fontSize: "0.9rem", color: "#94a3b8" }}>
                    {runError
                      ? runError
                      : isRunning
                        ? "Running agent"
                        : chatHistory.length > 0
                          ? "Ready"
                          : "Idle"}
                  </span>
                </div>
              </div>
            </form>
            <details
              style={{
                background: "#0f172a",
                borderRadius: 8,
                border: "1px solid #1f2937",
                padding: "1rem",
              }}
            >
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>Latest raw response</summary>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  marginTop: "0.75rem",
                }}
              >
                {latestResponse ? JSON.stringify(latestResponse, null, 2) : "No response yet."}
              </pre>
            </details>
          </section>
        ) : (
          <section
            style={{
              background: "#1e293b",
              borderRadius: 12,
              padding: "1.5rem",
              boxShadow: "inset 0 0 0 1px rgba(148,163,184,0.15)",
            }}
          >
            <LogFlowPanel traceId={traceId} />
          </section>
        )}
      </main>
    </div>
  );
};

export default HomePage;

import { FormEventHandler, useCallback, useMemo, useState } from "react";
import type { NextPage } from "next";
import LogFlowPanel from "../components/LogFlowPanel";
import type { ChatMessage } from "../types/chat";

const HomePage: NextPage = () => {
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [traceId, setTraceId] = useState<string | undefined>(undefined);
  const [finalOutput, setFinalOutput] = useState<any>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"chat" | "logflow">("chat");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);

  const handleRun = useCallback(async () => {
    if (isRunning) return;
    const prompt = input.trim();
    if (!prompt) {
      setRunError("Please enter a message before running.");
      return;
    }
    setIsRunning(true);
    setRunError(null);
    setTraceId(undefined);
    setFinalOutput(null);
    const previousHistory = chatHistory;
    const nextHistory = [...previousHistory, { role: "user", content: prompt }];
    setChatHistory(nextHistory);
    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt, messages: previousHistory }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) {
        throw new Error(data?.message ?? `Request failed (${response.status})`);
      }
      setTraceId(data.trace_id);
      setFinalOutput(data.result);
      const assistantReplyRaw = data?.result?.text ?? data?.result?.content ?? data?.result;
      let assistantReplyText = "";
      if (typeof assistantReplyRaw === "string") {
        assistantReplyText = assistantReplyRaw;
      } else if (assistantReplyRaw) {
        assistantReplyText = JSON.stringify(assistantReplyRaw, null, 2);
      }
      const replyContent = assistantReplyText.trim() || "(no response)";
      setChatHistory([...nextHistory, { role: "assistant", content: replyContent }]);
    } catch (err: any) {
      const message = err?.message ?? "Failed to run agent";
      setRunError(message);
      setChatHistory([...nextHistory, { role: "system", content: message }]);
    } finally {
      setIsRunning(false);
      setInput("");
    }
  }, [chatHistory, input, isRunning]);

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
                  {traceId
                    ? `trace_id: ${traceId}`
                    : runError
                      ? runError
                      : isRunning
                        ? "Running agent"
                        : "Idle"}
                </span>
              </div>
            </form>

            <div style={{ display: "grid", gap: "1.5rem" }}>
              <div>
                <h3 style={{ margin: "0 0 0.5rem" }}>Conversation</h3>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.75rem",
                    maxHeight: 360,
                    overflowY: "auto",
                    background: "#0f172a",
                    borderRadius: 8,
                    padding: "1rem",
                    border: "1px solid #1f2937",
                  }}
                >
                  {chatHistory.length === 0 ? (
                    <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.95rem" }}>
                      No messages yet. Start the conversation above.
                    </p>
                  ) : (
                    chatHistory.map((message, index) => {
                      const isUser = message.role === "user";
                      const isAssistant = message.role === "assistant";
                      const alignSelf = isUser ? "flex-end" : "flex-start";
                      const color = isUser ? "#0f172a" : "#e2e8f0";
                      let background = "#f97316";
                      if (isUser) {
                        background = "#38bdf8";
                      } else if (isAssistant) {
                        background = "#1f2937";
                      }
                      let label = "System";
                      if (isUser) {
                        label = "You";
                      } else if (isAssistant) {
                        label = "Agent";
                      }
                      return (
                        <div
                          key={`${message.role}-${index}`}
                          style={{
                            alignSelf,
                            maxWidth: "80%",
                            background,
                            color,
                            borderRadius: 12,
                            padding: "0.75rem 1rem",
                            boxShadow: "0 4px 12px rgba(15, 23, 42, 0.35)",
                            border: isAssistant ? "1px solid #334155" : "none",
                          }}
                        >
                          <div
                            style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "0.35rem" }}
                          >
                            {label}
                          </div>
                          <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                            {message.content}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div>
                <h3 style={{ margin: "0 0 0.5rem" }}>Final Output</h3>
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    background: "#0f172a",
                    borderRadius: 8,
                    padding: "1rem",
                    border: "1px solid #1f2937",
                    minHeight: 120,
                  }}
                >
                  {(() => {
                    if (!finalOutput) return "No output yet.";
                    const payload = finalOutput.raw ?? finalOutput;
                    if (typeof payload === "string") return payload;
                    try {
                      return JSON.stringify(payload, null, 2);
                    } catch (err) {
                      return String(payload);
                    }
                  })()}
                </pre>
              </div>
            </div>
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

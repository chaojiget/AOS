import { FormEventHandler, useCallback, useState } from "react";
import type { NextPage } from "next";
import LogFlowPanel from "../components/LogFlowPanel";

const HomePage: NextPage = () => {
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [traceId, setTraceId] = useState<string | undefined>(undefined);
  const [finalOutput, setFinalOutput] = useState<any>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"chat" | "log">("chat");

  const handleRun = useCallback(async () => {
    if (isRunning) return;
    const prompt = input.trim();
    setIsRunning(true);
    setRunError(null);
    setTraceId(undefined);
    setFinalOutput(null);
    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) {
        throw new Error(data?.message ?? `Request failed (${response.status})`);
      }
      setTraceId(data.trace_id);
      setFinalOutput(data.result);
    } catch (err: any) {
      setRunError(err?.message ?? "Failed to run agent");
    } finally {
      setIsRunning(false);
    }
  }, [input, isRunning]);

  const handleSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    (event) => {
      event.preventDefault();
      void handleRun();
    },
    [handleRun],
  );

  const tabs: { id: "chat" | "log"; label: string }[] = [
    { id: "chat", label: "Chat" },
    { id: "log", label: "Log Flow" },
  ];

  const panelStyle = {
    background: "#1e293b",
    borderRadius: 12,
    padding: "1.5rem",
    boxShadow: "inset 0 0 0 1px rgba(148,163,184,0.15)",
  } as const;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0f172a",
        color: "#e2e8f0",
      }}
    >
      <header
        style={{
          padding: "1.5rem 2rem",
          background: "#1e293b",
          boxShadow: "0 1px 12px rgba(0,0,0,0.4)",
        }}
      >
        <h1 style={{ margin: 0 }}>AgentOS · Chat + LogFlow</h1>
        <p style={{ margin: "0.25rem 0 0", fontSize: "0.95rem", color: "#94a3b8" }}>
          Submit a prompt to run the local agent, inspect timeline events, and explore task branches.
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
          aria-label="Agent panels"
          role="tablist"
          style={{
            display: "flex",
            gap: "0.75rem",
            background: "rgba(15, 23, 42, 0.6)",
            borderRadius: 999,
            padding: "0.4rem",
            border: "1px solid #334155",
          }}
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`${tab.id}-tab`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`${tab.id}-panel`}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1,
                  padding: "0.6rem 1.25rem",
                  borderRadius: 999,
                  border: "none",
                  background: isActive ? "#38bdf8" : "transparent",
                  color: isActive ? "#0f172a" : "#cbd5f5",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "background 0.2s ease, color 0.2s ease",
                  boxShadow: isActive ? "0 1px 6px rgba(56,189,248,0.35)" : "none",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {activeTab === "chat" ? (
          <section id="chat-panel" role="tabpanel" aria-labelledby="chat-tab" style={panelStyle}>
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

            <div style={{ marginTop: "1.5rem" }}>
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
                {finalOutput ? JSON.stringify(finalOutput, null, 2) : "No output yet."}
              </pre>
            </div>
          </section>
        ) : (
          <section id="log-panel" role="tabpanel" aria-labelledby="log-tab" style={panelStyle}>
            <LogFlowPanel traceId={traceId} />
          </section>
        )}
      </main>
    </div>
  );
};

export default HomePage;

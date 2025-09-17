import { FormEventHandler, useCallback, useMemo, useState } from "react";
import type { NextPage } from "next";
import LogFlowPanel from "../components/LogFlowPanel";

const HomePage: NextPage = () => {
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [traceId, setTraceId] = useState<string | undefined>(undefined);
  const [finalOutput, setFinalOutput] = useState<any>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"chat" | "logflow">("chat");

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
                {finalOutput ? JSON.stringify(finalOutput, null, 2) : "No output yet."}
              </pre>
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

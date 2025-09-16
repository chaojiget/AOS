import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BranchNode,
  BranchResponse,
  LogFlowMessage,
  MainlineResponse,
} from "../types/logflow";

interface LogFlowPanelProps {
  traceId?: string;
}

interface RequestState {
  loading: boolean;
  error: string | null;
}

const initialRequestState: RequestState = { loading: false, error: null };

export function LogFlowPanel({ traceId }: LogFlowPanelProps) {
  const [messages, setMessages] = useState<LogFlowMessage[]>([]);
  const [mainlineState, setMainlineState] = useState<RequestState>(initialRequestState);
  const [selectedMessage, setSelectedMessage] = useState<LogFlowMessage | null>(null);
  const [branchState, setBranchState] = useState<RequestState>(initialRequestState);
  const [branch, setBranch] = useState<BranchResponse | null>(null);
  const latestSelectionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!traceId) {
      setMessages([]);
      setSelectedMessage(null);
      setBranch(null);
      setMainlineState(initialRequestState);
      setBranchState(initialRequestState);
      latestSelectionRef.current = null;
      return;
    }

    let cancelled = false;
    setMainlineState({ loading: true, error: null });
    setSelectedMessage(null);
    setBranch(null);
    setBranchState(initialRequestState);
    latestSelectionRef.current = null;

    const controller = new AbortController();

    fetch(`/api/logflow/mainline?trace_id=${encodeURIComponent(traceId)}`, {
      signal: controller.signal,
    })
      .then(async (resp) => {
        if (!resp.ok) {
          const detail = await resp.json().catch(() => ({}));
          throw new Error(detail?.message ?? `Failed to load mainline (${resp.status})`);
        }
        return (await resp.json()) as MainlineResponse;
      })
      .then((data) => {
        if (cancelled) return;
        setMessages(data.messages);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setMessages([]);
        setMainlineState({ loading: false, error: err?.message ?? "Failed to load mainline" });
      })
      .finally(() => {
        if (cancelled) return;
        setMainlineState((prev) => ({ ...prev, loading: false }));
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [traceId]);

  const handleSelect = useCallback(
    (message: LogFlowMessage) => {
      if (!traceId) return;
      setSelectedMessage(message);
      latestSelectionRef.current = message.id;
      setBranch(null);
      setBranchState({ loading: true, error: null });

      const params = new URLSearchParams({ trace_id: traceId });
      if (message.span_id) {
        params.set("span_id", message.span_id);
      } else {
        params.set("ln", String(message.ln));
      }

      fetch(`/api/logflow/branch?${params.toString()}`)
        .then(async (resp) => {
          if (!resp.ok) {
            const detail = await resp.json().catch(() => ({}));
            throw new Error(detail?.message ?? `Failed to load branch (${resp.status})`);
          }
          return (await resp.json()) as BranchResponse;
        })
        .then((data) => {
          if (latestSelectionRef.current !== message.id) {
            return;
          }
          setBranch(data);
          setBranchState({ loading: false, error: null });
        })
        .catch((err: any) => {
          if (latestSelectionRef.current !== message.id) {
            return;
          }
          setBranch(null);
          setBranchState({ loading: false, error: err?.message ?? "Failed to load branch" });
        });
    },
    [traceId],
  );

  const selectedBranchNode = useMemo<BranchNode | null>(() => {
    if (!branch?.tree) return null;
    return branch.tree;
  }, [branch]);

  return (
    <section style={{ display: "grid", gap: "1rem" }}>
      <header>
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>LogFlow</h2>
        {traceId ? (
          <p style={{ margin: 0, fontSize: "0.85rem", color: "#94a3b8" }}>
            trace_id: <code>{traceId}</code>
          </p>
        ) : (
          <p style={{ margin: 0, fontSize: "0.85rem", color: "#94a3b8" }}>
            Submit a run to see timeline and branch details.
          </p>
        )}
      </header>

      <div
        style={{
          display: "flex",
          gap: "1rem",
          alignItems: "flex-start",
          background: "#0f172a",
          border: "1px solid #1f2937",
          borderRadius: 12,
          padding: "1rem",
        }}
      >
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>Mainline Messages</h3>
          {mainlineState.loading ? (
            <p style={{ fontSize: "0.9rem", color: "#94a3b8" }}>Loading mainline…</p>
          ) : mainlineState.error ? (
            <p style={{ fontSize: "0.9rem", color: "#f87171" }}>{mainlineState.error}</p>
          ) : messages.length === 0 ? (
            <p style={{ fontSize: "0.9rem", color: "#94a3b8" }}>No events recorded yet.</p>
          ) : (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                maxHeight: 320,
                overflowY: "auto",
              }}
            >
              {messages.map((message) => {
                const isSelected = selectedMessage?.id === message.id;
                return (
                  <li key={message.id} style={{ marginBottom: "0.5rem" }}>
                    <button
                      type="button"
                      onClick={() => handleSelect(message)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        borderRadius: 8,
                        border: "1px solid",
                        borderColor: isSelected ? "#38bdf8" : "#1f2937",
                        background: isSelected ? "rgba(56, 189, 248, 0.12)" : "#0f172a",
                        padding: "0.5rem 0.75rem",
                        color: "inherit",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{message.message}</div>
                      <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                        ln {message.ln}
                        {message.span_id ? ` · span ${message.span_id}` : ""}
                        {message.type ? ` · ${message.type}` : ""}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div style={{ flex: 1 }}>
          <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>Branch Detail</h3>
          {selectedMessage ? (
            <div style={{ marginBottom: "0.75rem", fontSize: "0.85rem", color: "#94a3b8" }}>
              <div>
                Selected message ln {selectedMessage.ln}
                {selectedMessage.span_id ? ` (span ${selectedMessage.span_id})` : ""}
              </div>
              <div>Type: {selectedMessage.type}</div>
            </div>
          ) : (
            <p style={{ fontSize: "0.9rem", color: "#94a3b8" }}>
              Select a message to inspect its branch timeline.
            </p>
          )}

          {branchState.loading ? (
            <p style={{ fontSize: "0.9rem", color: "#94a3b8" }}>Loading branch…</p>
          ) : branchState.error ? (
            <p style={{ fontSize: "0.9rem", color: "#f87171" }}>{branchState.error}</p>
          ) : branch ? (
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <div style={{ fontSize: "0.85rem", color: "#94a3b8" }}>
                Origin: {branch.origin.span_id ? `span ${branch.origin.span_id}` : "message"}
                {branch.origin.ln !== undefined ? ` · ln ${branch.origin.ln}` : ""}
              </div>
              {branch.messages.length > 0 && (
                <div>
                  <h4 style={{ margin: "0 0 0.25rem", fontSize: "0.95rem" }}>Events</h4>
                  <ul
                    style={{
                      listStyle: "none",
                      padding: 0,
                      margin: 0,
                      maxHeight: 200,
                      overflowY: "auto",
                    }}
                  >
                    {branch.messages.map((msg) => (
                      <li key={msg.id} style={{ marginBottom: "0.4rem" }}>
                        <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{msg.message}</div>
                        <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                          ln {msg.ln}
                          {msg.span_id ? ` · span ${msg.span_id}` : ""}
                          {msg.type ? ` · ${msg.type}` : ""}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {selectedBranchNode ? (
                <div>
                  <h4 style={{ margin: "0 0 0.25rem", fontSize: "0.95rem" }}>Task Tree</h4>
                  <div style={{ maxHeight: 220, overflowY: "auto" }}>
                    {renderBranchNode(selectedBranchNode)}
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: "0.9rem", color: "#94a3b8" }}>
                  No task tree available for this selection.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function renderBranchNode(node: BranchNode, depth = 0): JSX.Element {
  return (
    <div key={node.span_id} style={{ marginLeft: depth ? depth * 12 : 0 }}>
      <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
        span {node.span_id} · ln {node.first_ln} – {node.last_ln}
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: "0.25rem 0 0.5rem" }}>
        {node.events.map((evt) => (
          <li key={evt.id} style={{ marginBottom: "0.25rem" }}>
            <div style={{ fontSize: "0.85rem" }}>{evt.message}</div>
            <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>
              ln {evt.ln}
              {evt.type ? ` · ${evt.type}` : ""}
            </div>
          </li>
        ))}
      </ul>
      {node.children.map((child) => renderBranchNode(child, depth + 1))}
    </div>
  );
}

export default LogFlowPanel;

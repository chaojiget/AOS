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
  const [copied, setCopied] = useState(false);
  const branchCards = useMemo(() => {
    if (!branch?.tree) return [];
    return flattenBranchNodes(branch.tree);
  }, [branch]);

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

  const selectedPayload = useMemo(() => {
    if (!selectedMessage) return null;
    try {
      return JSON.stringify(selectedMessage.data, null, 2);
    } catch {
      return typeof selectedMessage.data === "string"
        ? selectedMessage.data
        : String(selectedMessage.data);
    }
  }, [selectedMessage]);

  useEffect(() => {
    setCopied(false);
  }, [selectedPayload]);

  const handleCopyPayload = useCallback(() => {
    if (!selectedPayload) return;
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }
    navigator.clipboard
      .writeText(selectedPayload)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        setCopied(false);
      });
  }, [selectedPayload]);

  return (
    <section style={{ border: "1px solid #1f2937", borderRadius: 12, padding: "1rem" }}>
      <header style={{ marginBottom: "0.75rem" }}>
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

      <div style={{ display: "flex", gap: "1rem", alignItems: "stretch", flexWrap: "wrap" }}>
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

        <div style={{ flex: 1, minWidth: 320, display: "grid", gap: "1rem" }}>
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
              <div>
                <div style={{ fontSize: "0.85rem", color: "#94a3b8", marginBottom: "0.5rem" }}>
                  Origin: {branch.origin.span_id ? `span ${branch.origin.span_id}` : "message"}
                  {branch.origin.ln !== undefined ? ` · ln ${branch.origin.ln}` : ""}
                </div>
                {branchCards.length > 0 ? (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "0.75rem",
                    }}
                  >
                    {branchCards.map(({ node, depth }) => (
                      <div
                        key={`${node.span_id}-${depth}`}
                        style={{
                          flex: "1 1 180px",
                          minWidth: 160,
                          border: "1px solid #1f2937",
                          borderRadius: 10,
                          background: "#0f172a",
                          padding: "0.75rem",
                          boxShadow: depth
                            ? "inset 0 0 0 1px rgba(56, 189, 248, 0.15)"
                            : "inset 0 0 0 1px rgba(148, 163, 184, 0.2)",
                        }}
                      >
                        <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                          {depth === 0 ? "Root span" : `Depth ${depth}`}
                        </div>
                        <div style={{ fontWeight: 600 }}>{node.span_id}</div>
                        <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                          Parent: {node.parent_span_id ?? "—"}
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                          Lines {node.first_ln} – {node.last_ln}
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                          Events {node.events.length}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ fontSize: "0.85rem", color: "#94a3b8" }}>
                    No span hierarchy available for this selection.
                  </p>
                )}
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
                    {branch.messages.map((msg: LogFlowMessage) => (
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

          {selectedPayload && (
            <div>
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <h4 style={{ margin: "0 0 0.25rem", fontSize: "0.95rem" }}>Event Payload</h4>
                <button
                  type="button"
                  onClick={handleCopyPayload}
                  style={{
                    padding: "0.25rem 0.75rem",
                    borderRadius: 999,
                    border: "1px solid #38bdf8",
                    background: "transparent",
                    color: "#38bdf8",
                    fontSize: "0.8rem",
                    cursor: "pointer",
                  }}
                >
                  {copied ? "Copied" : "Copy JSON"}
                </button>
              </div>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  background: "#0f172a",
                  borderRadius: 8,
                  padding: "0.75rem",
                  border: "1px solid #1f2937",
                  maxHeight: 220,
                  overflowY: "auto",
                  fontSize: "0.8rem",
                }}
              >
                {selectedPayload}
              </pre>
            </div>
          )}
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
        {node.events.map((evt: LogFlowMessage) => (
          <li key={evt.id} style={{ marginBottom: "0.25rem" }}>
            <div style={{ fontSize: "0.85rem" }}>{evt.message}</div>
            <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>
              ln {evt.ln}
              {evt.type ? ` · ${evt.type}` : ""}
            </div>
          </li>
        ))}
      </ul>
      {node.children.map((child: BranchNode) => renderBranchNode(child, depth + 1))}
    </div>
  );
}

function flattenBranchNodes(node: BranchNode, depth = 0): Array<{ node: BranchNode; depth: number }> {
  const current = [{ node, depth }];
  const children = node.children.flatMap((child) => flattenBranchNodes(child, depth + 1));
  return [...current, ...children];
}

export default LogFlowPanel;

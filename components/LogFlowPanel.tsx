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
  const [isDataExpanded, setIsDataExpanded] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const latestSelectionRef = useRef<string | null>(null);
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const formattedSelectedData = useMemo(() => {
    if (!selectedMessage) return null;
    const { data } = selectedMessage;
    if (data === undefined) {
      return null;
    }

    const safeStringify = (value: unknown): string => {
      const seen = new WeakSet<object>();
      return JSON.stringify(
        value,
        (_key, val) => {
          if (typeof val === "bigint") {
            return val.toString();
          }
          if (typeof val === "object" && val !== null) {
            if (seen.has(val)) {
              return "[Circular]";
            }
            seen.add(val);
          }
          return val;
        },
        2,
      );
    };

    try {
      if (typeof data === "string") {
        const trimmed = data.trim();
        if (!trimmed) {
          return '""';
        }
        try {
          return safeStringify(JSON.parse(trimmed));
        } catch {
          return safeStringify(data);
        }
      }
      return safeStringify(data);
    } catch {
      if (typeof data === "string") {
        return data;
      }
      return String(data);
    }
  }, [selectedMessage]);

  useEffect(() => {
    if (copyResetTimeoutRef.current) {
      clearTimeout(copyResetTimeoutRef.current);
      copyResetTimeoutRef.current = null;
    }
    setCopyStatus("idle");
    setIsDataExpanded(Boolean(formattedSelectedData));
  }, [formattedSelectedData]);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  const toggleDataExpanded = useCallback(() => {
    setIsDataExpanded((prev) => !prev);
  }, []);

  const handleCopyData = useCallback(() => {
    if (!formattedSelectedData) {
      return;
    }
    const scheduleReset = () => {
      if (copyResetTimeoutRef.current) {
        clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = setTimeout(() => {
        setCopyStatus("idle");
        copyResetTimeoutRef.current = null;
      }, 1500);
    };

    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setCopyStatus("error");
      scheduleReset();
      return;
    }

    navigator.clipboard
      .writeText(formattedSelectedData)
      .then(() => {
        setCopyStatus("copied");
        scheduleReset();
      })
      .catch(() => {
        setCopyStatus("error");
        scheduleReset();
      });
  }, [formattedSelectedData]);

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
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
                marginBottom: "0.75rem",
              }}
            >
              <div style={{ fontSize: "0.85rem", color: "#94a3b8" }}>
                <div>
                  Selected message ln {selectedMessage.ln}
                  {selectedMessage.span_id ? ` (span ${selectedMessage.span_id})` : ""}
                </div>
                <div>Type: {selectedMessage.type}</div>
              </div>
              {formattedSelectedData ? (
                <div
                  style={{
                    border: "1px solid #1f2937",
                    borderRadius: 8,
                    background: "#0f172a",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "0.5rem",
                      padding: "0.5rem 0.75rem",
                      borderBottom: isDataExpanded ? "1px solid #1f2937" : undefined,
                    }}
                  >
                    <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Event Data</span>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        flexWrap: "wrap",
                      }}
                    >
                      {copyStatus === "copied" ? (
                        <span style={{ fontSize: "0.75rem", color: "#34d399" }}>Copied!</span>
                      ) : copyStatus === "error" ? (
                        <span style={{ fontSize: "0.75rem", color: "#f87171" }}>Copy failed</span>
                      ) : null}
                      <button
                        type="button"
                        onClick={toggleDataExpanded}
                        style={{
                          borderRadius: 6,
                          border: "1px solid",
                          borderColor: isDataExpanded ? "#38bdf8" : "#1f2937",
                          background: isDataExpanded ? "rgba(56, 189, 248, 0.12)" : "#1f2937",
                          color: "#e2e8f0",
                          padding: "0.35rem 0.6rem",
                          fontSize: "0.75rem",
                          cursor: "pointer",
                        }}
                      >
                        {isDataExpanded ? "Collapse" : "Expand"}
                      </button>
                      <button
                        type="button"
                        onClick={handleCopyData}
                        disabled={!formattedSelectedData}
                        style={{
                          borderRadius: 6,
                          border: "1px solid #1f2937",
                          background: "#1f2937",
                          color: "#e2e8f0",
                          padding: "0.35rem 0.6rem",
                          fontSize: "0.75rem",
                          cursor: formattedSelectedData ? "pointer" : "not-allowed",
                          opacity: formattedSelectedData ? 1 : 0.6,
                        }}
                      >
                        Copy JSON
                      </button>
                    </div>
                  </div>
                  {isDataExpanded ? (
                    <pre
                      style={{
                        margin: 0,
                        padding: "0.75rem",
                        fontSize: "0.75rem",
                        lineHeight: 1.5,
                        maxHeight: 240,
                        overflow: "auto",
                        color: "#e2e8f0",
                        fontFamily:
                          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                        whiteSpace: "pre",
                      }}
                    >
                      {formattedSelectedData}
                    </pre>
                  ) : null}
                </div>
              ) : (
                <p style={{ fontSize: "0.85rem", color: "#94a3b8" }}>
                  Selected event has no data payload.
                </p>
              )}
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

export default LogFlowPanel;

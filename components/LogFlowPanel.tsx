import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  badgeClass,
  headingClass,
  insetSurfaceClass,
  labelClass,
  outlineButtonClass,
  subtleTextClass,
} from "../lib/theme";
import type { BranchNode, BranchResponse, LogFlowMessage } from "../types/logflow";

interface LogFlowPanelProps {
  traceId?: string;
}

interface RequestState {
  loading: boolean;
  error: string | null;
}

interface RunEventsResponse {
  events?: LogFlowMessage[];
  items?: LogFlowMessage[];
  next_cursor?: string | null;
  next?: string | null;
  stats?: {
    tokens?: number;
    cost?: number;
    latency_ms?: number;
  };
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
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [stats, setStats] = useState<{
    tokens?: number;
    cost?: number;
    latency_ms?: number;
  } | null>(null);

  const branchCards = useMemo(() => {
    if (!branch?.tree) return [];
    return flattenBranchNodes(branch.tree);
  }, [branch]);

  const resetState = useCallback(() => {
    setMessages([]);
    setSelectedMessage(null);
    setBranch(null);
    setMainlineState(initialRequestState);
    setBranchState(initialRequestState);
    latestSelectionRef.current = null;
    setCursor(null);
    setStats(null);
  }, []);

  const fetchPage = useCallback(
    async (runId: string, nextCursor: string | null, append: boolean) => {
      const params = new URLSearchParams();
      if (nextCursor) {
        params.set("cursor", nextCursor);
      }
      params.set("limit", "200");
      const response = await fetch(
        `/api/runs/${encodeURIComponent(runId)}/events?${params.toString()}`,
      );
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail?.message ?? `Failed to load events (${response.status})`);
      }
      const payload = (await response.json()) as RunEventsResponse;
      const items = payload.events ?? payload.items ?? [];
      setStats(payload.stats ?? null);
      setMessages((prev) => (append ? [...prev, ...items] : items));
      setCursor(payload.next_cursor ?? payload.next ?? null);
      if (!append && items.length > 0) {
        setSelectedMessage(items[0]);
        latestSelectionRef.current = items[0]?.id ?? null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!traceId) {
      resetState();
      return;
    }
    let cancelled = false;
    setMainlineState({ loading: true, error: null });
    fetchPage(traceId, null, false)
      .catch((err: any) => {
        if (cancelled) return;
        resetState();
        setMainlineState({ loading: false, error: err?.message ?? "Failed to load events" });
      })
      .finally(() => {
        if (cancelled) return;
        setMainlineState((prev) => ({ ...prev, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [traceId, fetchPage, resetState]);

  const handleLoadMore = useCallback(() => {
    if (!traceId || !cursor) return;
    setLoadingMore(true);
    fetchPage(traceId, cursor, true)
      .catch((err: any) => {
        setMainlineState((prev) => ({ ...prev, error: err?.message ?? "Failed to load events" }));
      })
      .finally(() => {
        setLoadingMore(false);
      });
  }, [cursor, fetchPage, traceId]);

  const handleSelect = useCallback(
    (message: LogFlowMessage) => {
      if (!traceId) return;
      setSelectedMessage(message);
      latestSelectionRef.current = message.id;
      setBranch(null);
      setBranchState({ loading: true, error: null });

      if (!message.span_id) {
        setBranch(null);
        setBranchState({
          loading: false,
          error: "Selected event is missing span information",
        });
        return;
      }

      const params = new URLSearchParams({ trace_id: traceId });
      params.set("span_id", message.span_id);

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
    <div className="space-y-6">
      <header className="space-y-2">
        <h2 className={headingClass}>LogFlow</h2>
        {traceId ? (
          <p className={`${subtleTextClass} text-xs`}>
            trace_id: <code className="text-slate-200">{traceId}</code>
          </p>
        ) : (
          <p className={`${subtleTextClass} text-xs`}>
            Submit a run to see timeline and branch details.
          </p>
        )}
        {stats ? (
          <dl className="flex flex-wrap gap-4 text-xs uppercase tracking-[0.18em] text-slate-300">
            <div className="flex items-center gap-2">
              <dt className={`${badgeClass} bg-transparent px-2 py-0`}>tokens</dt>
              <dd>{typeof stats.tokens === "number" ? stats.tokens.toLocaleString() : "–"}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className={`${badgeClass} bg-transparent px-2 py-0`}>cost</dt>
              <dd>{typeof stats.cost === "number" ? stats.cost.toFixed(4) : "–"}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className={`${badgeClass} bg-transparent px-2 py-0`}>latency</dt>
              <dd>
                {typeof stats.latency_ms === "number" ? `${stats.latency_ms.toFixed(0)} ms` : "–"}
              </dd>
            </div>
          </dl>
        ) : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="space-y-4" aria-labelledby="logflow-mainline">
          <div className="flex items-center justify-between gap-2">
            <h3 id="logflow-mainline" className={headingClass}>
              Mainline Events
            </h3>
            {cursor ? (
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className={outlineButtonClass}
                data-testid="logflow-load-more"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            ) : null}
          </div>
          {mainlineState.loading ? (
            <p className={`${subtleTextClass} text-sm`}>Loading events…</p>
          ) : mainlineState.error ? (
            <p className="text-sm text-orange-300">{mainlineState.error}</p>
          ) : messages.length === 0 ? (
            <p className={`${subtleTextClass} text-sm`}>No events recorded yet.</p>
          ) : (
            <ul className="space-y-3" data-testid="logflow-events">
              {messages.map((message) => {
                const isSelected = selectedMessage?.id === message.id;
                return (
                  <li key={message.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(message)}
                      className={`${insetSurfaceClass} w-full border ${
                        isSelected ? "border-sky-400/70" : "border-slate-800/70"
                      } text-left transition hover:border-sky-300/80`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-slate-100">{message.message}</span>
                        <span className={`${subtleTextClass} text-xs`}>
                          ln {message.ln}
                          {message.span_id ? ` · span ${message.span_id}` : ""}
                          {message.type ? ` · ${message.type}` : ""}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="space-y-4" aria-labelledby="logflow-branch">
          <h3 id="logflow-branch" className={headingClass}>
            Branch Detail
          </h3>
          {selectedMessage ? (
            <div className={`${subtleTextClass} space-y-1 text-xs`}>
              <div>
                Selected message ln {selectedMessage.ln}
                {selectedMessage.span_id ? ` (span ${selectedMessage.span_id})` : ""}
              </div>
              <div>Type: {selectedMessage.type}</div>
            </div>
          ) : (
            <p className={`${subtleTextClass} text-sm`}>
              Select a message to inspect its branch timeline.
            </p>
          )}

          {branchState.loading ? (
            <p className={`${subtleTextClass} text-sm`}>Loading branch…</p>
          ) : branchState.error ? (
            <p className="text-sm text-orange-300">{branchState.error}</p>
          ) : branch ? (
            <div className="space-y-4">
              <div className={`${subtleTextClass} text-xs`}>
                Origin: {branch.origin.span_id ? `span ${branch.origin.span_id}` : "message"}
                {branch.origin.ln !== undefined ? ` · ln ${branch.origin.ln}` : ""}
              </div>
              {branchCards.length > 0 ? (
                <div className="flex flex-wrap gap-3" data-testid="branch-cards">
                  {branchCards.map(({ node, depth }) => (
                    <article
                      key={`${node.span_id}-${depth}`}
                      className={`${insetSurfaceClass} min-w-[12rem] flex-1 space-y-2 border-slate-800/70 p-3`}
                    >
                      <div className={`${labelClass} text-slate-300`}>
                        {depth === 0 ? "Root span" : `Depth ${depth}`}
                      </div>
                      <div className="text-sm font-semibold text-slate-100">{node.span_id}</div>
                      <p className={`${subtleTextClass} text-xs`}>
                        Parent: {node.parent_span_id ?? "—"}
                      </p>
                      <p className={`${subtleTextClass} text-xs`}>
                        Lines {node.first_ln} – {node.last_ln}
                      </p>
                      <p className={`${subtleTextClass} text-xs`}>Events {node.events.length}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className={`${subtleTextClass} text-sm`}>
                  No span hierarchy available for this selection.
                </p>
              )}

              {branch.messages.length > 0 ? (
                <div className="space-y-2">
                  <h4 className={headingClass}>Events</h4>
                  <ul className="space-y-2" data-testid="branch-events">
                    {branch.messages.map((msg: LogFlowMessage) => (
                      <li key={msg.id} className={`${insetSurfaceClass} border-slate-800/70 p-3`}>
                        <div className="font-semibold text-slate-100">{msg.message}</div>
                        <div className={`${subtleTextClass} text-xs`}>
                          ln {msg.ln}
                          {msg.span_id ? ` · span ${msg.span_id}` : ""}
                          {msg.type ? ` · ${msg.type}` : ""}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {selectedBranchNode ? (
                <div className="space-y-2">
                  <h4 className={headingClass}>Task Tree</h4>
                  <div
                    className={`${insetSurfaceClass} max-h-56 space-y-2 overflow-y-auto border-slate-800/70 p-3`}
                  >
                    {renderBranchNode(selectedBranchNode)}
                  </div>
                </div>
              ) : (
                <p className={`${subtleTextClass} text-sm`}>
                  No task tree available for this selection.
                </p>
              )}
            </div>
          ) : null}

          {selectedPayload ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className={headingClass}>Event Payload</h4>
                <button type="button" onClick={handleCopyPayload} className={outlineButtonClass}>
                  {copied ? "Copied" : "Copy JSON"}
                </button>
              </div>
              <pre
                className={`${insetSurfaceClass} max-h-60 overflow-y-auto border-slate-800/70 p-3 text-xs leading-relaxed`}
              >
                {selectedPayload}
              </pre>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function renderBranchNode(node: BranchNode, depth = 0): JSX.Element {
  return (
    <div key={node.span_id} className="space-y-1" style={{ marginLeft: depth ? depth * 12 : 0 }}>
      <div className="text-sm font-semibold text-slate-100">
        span {node.span_id} · ln {node.first_ln} – {node.last_ln}
      </div>
      <ul className="space-y-1 text-xs text-slate-300">
        {node.events.map((evt: LogFlowMessage) => (
          <li key={evt.id}>
            <div>{evt.message}</div>
            <div className="text-[0.7rem] uppercase tracking-[0.14em] text-slate-400">
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

function flattenBranchNodes(
  node: BranchNode,
  depth = 0,
): Array<{ node: BranchNode; depth: number }> {
  const current = [{ node, depth }];
  const children = node.children.flatMap((child) => flattenBranchNodes(child, depth + 1));
  return [...current, ...children];
}

export default LogFlowPanel;

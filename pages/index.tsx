import { FormEventHandler, useCallback, useMemo, useState } from "react";
import type { NextPage } from "next";
import ChatMessageList, { type ChatHistoryMessage } from "../components/ChatMessageList";
import LogFlowPanel from "../components/LogFlowPanel";
import {
  badgeClass,
  headerSurfaceClass,
  headingClass,
  insetSurfaceClass,
  labelClass,
  outlineButtonClass,
  pageContainerClass,
  panelSurfaceClass,
  pillGroupClass,
  primaryButtonClass,
  shellClass,
  subtleTextClass,
} from "../lib/theme";

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
  const [finalOutput, setFinalOutput] = useState<any>(null);

  const draftInput = useMemo(() => input.trim(), [input]);

  const handleSaveConversation = useCallback(() => {
    const entries: Array<Record<string, unknown>> = chatHistory.map((message) => ({
      role: message.role,
      text: message.content,
      timestamp: message.ts,
      ...(message.msgId ? { msg_id: message.msgId } : {}),
      ...(message.traceId ? { trace_id: message.traceId } : {}),
      ...(message.status ? { status: message.status } : {}),
      ...(typeof message.latencyMs === "number" ? { latency_ms: message.latencyMs } : {}),
      ...(typeof message.cost === "number" ? { cost: message.cost } : {}),
      ...(message.error ? { error: message.error } : {}),
    }));

    if (draftInput) {
      entries.push({
        role: "user",
        text: draftInput,
        timestamp: new Date().toISOString(),
        draft: true,
      });
    }

    if (entries.length === 0) {
      return;
    }

    const blob = new Blob([JSON.stringify(entries, null, 2)], {
      type: "application/json",
    });
    const idPart = traceId ? `-${traceId}` : `-${Date.now()}`;
    const filename = `conversation${idPart}.json`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
  }, [chatHistory, draftInput, traceId]);

  const handleRun = useCallback(async () => {
    if (isRunning) return;
    const prompt = input.trim();
    if (!prompt) return;

    const previousHistory = chatHistory;
    const previousTraceId = traceId;
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
    const historyForRequest = [...previousHistory, userMessage];

    setChatHistory(historyForRequest);
    setIsRunning(true);
    setRunError(null);
    setTraceId(undefined);
    setLatestResponse(null);
    setLatencyMs(null);
    setCost(null);
    setFinalOutput(null);
    setInput("");
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      const serialisedHistory = serialiseHistoryForRequest(previousHistory);
      const messagesForRequest = serialisedHistory.map(({ role, content }) => ({ role, content }));

      const response = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: prompt,
          messages: messagesForRequest,
          history: serialisedHistory,
          ...(previousTraceId ? { trace_id: previousTraceId } : {}),
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
      setFinalOutput(data.result ?? data.final ?? data.output ?? data.message ?? null);

      const computedLatency =
        data.metrics?.latency_ms ??
        (typeof performance !== "undefined"
          ? Math.round(performance.now() - startedAt)
          : Date.now() - startedAt);
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
      setFinalOutput(null);
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

  const statusText = runError
    ? runError
    : isRunning
      ? "Running agent"
      : chatHistory.length > 0
        ? "Ready"
        : "Idle";

  const statusTone = runError ? "text-orange-300" : isRunning ? "text-sky-200" : "text-slate-200";

  const disableSave = !chatHistory.length && !draftInput;

  return (
    <div className={shellClass} data-testid="chat-shell">
      <header className={`${headerSurfaceClass} px-6 py-8 sm:px-8`} data-testid="chat-header">
        <div className="mx-auto w-full max-w-6xl space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-50">
            AgentOS · Chat + LogFlow
          </h1>
          <p className={`${subtleTextClass} max-w-3xl text-sm sm:text-base`}>
            Submit a prompt to run the local agent, inspect timeline events, and explore task
            branches.
          </p>
        </div>
      </header>

      <main className={`${pageContainerClass} space-y-8`} data-testid="chat-main">
        <nav
          aria-label="Primary"
          className={`${pillGroupClass} mx-auto max-w-md`}
          data-testid="chat-nav"
        >
          {tabItems.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-pressed={selected}
                className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 ${
                  selected
                    ? "bg-sky-400 text-slate-950 shadow-[0_12px_30px_rgba(56,189,248,0.35)]"
                    : "text-slate-300 hover:bg-slate-800/60 hover:text-slate-100"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {activeTab === "chat" ? (
          <div
            className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]"
            data-testid="chat-layout"
          >
            <section
              aria-labelledby="conversation-title"
              className={`${panelSurfaceClass} space-y-6 p-6 sm:p-8`}
              data-testid="conversation-panel"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2">
                  <h3 id="conversation-title" className={headingClass}>
                    Conversation
                  </h3>
                  <p className={`${subtleTextClass} text-xs sm:text-sm`}>
                    Review exchanged messages, drafts, and final outputs for the current run.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-3 text-xs sm:text-sm">
                  {traceId ? (
                    <span className="flex items-center gap-2 truncate text-sky-200">
                      <span className={`${badgeClass} bg-sky-500/10 text-sky-100`}>episodes</span>
                      <span className="truncate text-slate-200">episodes/{traceId}.jsonl</span>
                      <a
                        className="text-sky-300 underline decoration-dotted underline-offset-4 transition hover:text-sky-100"
                        href={`/api/episodes/${traceId}`}
                      >
                        下载 JSONL
                      </a>
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleSaveConversation}
                    disabled={disableSave}
                    className={`${outlineButtonClass} whitespace-nowrap`}
                  >
                    保存对话
                  </button>
                </div>
              </div>

              <ChatMessageList messages={chatHistory} isRunning={isRunning} />

              {draftInput ? (
                <div
                  className={`${insetSurfaceClass} border-dashed border-slate-700/60 bg-slate-950/40 p-4`}
                >
                  <div className={`${labelClass} text-slate-400`}>Draft input</div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">{draftInput}</p>
                </div>
              ) : null}

              {finalOutput ? (
                <div className="space-y-3">
                  <div className={`${labelClass} text-slate-400`}>Latest final output snapshot</div>
                  <pre className="max-h-72 overflow-auto rounded-2xl border border-slate-800/70 bg-slate-950/60 p-4 text-xs leading-relaxed text-slate-200">
                    {JSON.stringify(finalOutput, null, 2)}
                  </pre>
                </div>
              ) : null}

              <form onSubmit={handleSubmit} className="space-y-4">
                <label htmlFor="prompt" className={`${labelClass} text-slate-300`}>
                  Chat input
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
                  className={`${insetSurfaceClass} min-h-[9rem] w-full resize-y border-slate-800/70 bg-slate-950/70 p-4 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400`}
                />
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="submit"
                    disabled={isRunning}
                    className={`${primaryButtonClass} w-full sm:w-auto`}
                  >
                    {isRunning ? "Running…" : "Run"}
                  </button>
                  <span className={`${subtleTextClass} text-sm`}>{statusText}</span>
                </div>
              </form>
            </section>

            <div className="grid gap-6" data-testid="sidebar-panels">
              <section
                aria-labelledby="run-stats-title"
                className={`${panelSurfaceClass} space-y-6 p-6 sm:p-7`}
                data-testid="run-stats-panel"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 id="run-stats-title" className={headingClass}>
                    Run stats
                  </h3>
                  <span className={`${badgeClass} ${statusTone} bg-transparent normal-case`}>
                    {statusText}
                  </span>
                </div>
                <dl className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <dt className={`${labelClass} text-slate-400`}>Trace ID</dt>
                    <dd className="font-mono text-sm text-slate-200">{traceId ?? "–"}</dd>
                  </div>
                  <div className="space-y-2">
                    <dt className={`${labelClass} text-slate-400`}>Latency</dt>
                    <dd className="text-sm text-slate-200">
                      {typeof latencyMs === "number" ? `${latencyMs.toFixed(0)} ms` : "–"}
                    </dd>
                  </div>
                  <div className="space-y-2">
                    <dt className={`${labelClass} text-slate-400`}>Cost</dt>
                    <dd className="text-sm text-slate-200">
                      {typeof cost === "number" ? cost.toFixed(4) : "–"}
                    </dd>
                  </div>
                </dl>
                {runError ? (
                  <p className="rounded-2xl border border-orange-500/50 bg-orange-500/10 px-4 py-3 text-sm text-orange-200">
                    {runError}
                  </p>
                ) : (
                  <p className={`${subtleTextClass} text-xs`}>
                    Status updates as new events stream in from the agent runtime.
                  </p>
                )}
              </section>

              <section
                aria-labelledby="raw-response-title"
                className={`${panelSurfaceClass} space-y-4 p-6 sm:p-7`}
                data-testid="raw-response-panel"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 id="raw-response-title" className={headingClass}>
                    Latest raw response
                  </h3>
                  {latestResponse ? (
                    <span className={`${badgeClass} bg-sky-500/10 text-sky-100`}>updated</span>
                  ) : null}
                </div>
                <pre className="max-h-[28rem] overflow-auto rounded-2xl border border-slate-800/70 bg-slate-950/60 p-4 text-xs leading-relaxed text-slate-200">
                  {latestResponse ? JSON.stringify(latestResponse, null, 2) : "No response yet."}
                </pre>
              </section>
            </div>
          </div>
        ) : (
          <section className={`${panelSurfaceClass} p-6 sm:p-8`}>
            <LogFlowPanel traceId={traceId} />
          </section>
        )}
      </main>
    </div>
  );
};

export default HomePage;

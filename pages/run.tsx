import { NextPage } from "next";
import Head from "next/head";
import type { FC, FormEvent } from "react";
import { useCallback, useState } from "react";

interface ChatSendResponse {
  trace_id: string;
  msg_id: string;
  result?: unknown;
}

interface ChatPanelProps {
  message: string;
  onMessageChange: (value: string) => void;
  onRun: () => void;
  isRunning: boolean;
  status: string;
  finalOutput: string;
}

interface LogFlowPanelProps {
  traceId: string | null;
  log: string;
  isLoading: boolean;
}

const formatResult = (result: unknown): string => {
  if (result === null || result === undefined) {
    return "Result is empty.";
  }

  if (typeof result === "string") {
    return result;
  }

  try {
    return JSON.stringify(result, null, 2);
  } catch (error) {
    return String(result);
  }
};

const ChatPanel: FC<ChatPanelProps> = ({
  message,
  onMessageChange,
  onRun,
  isRunning,
  status,
  finalOutput,
}) => {
  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      onRun();
    },
    [onRun],
  );

  return (
    <section className="flex flex-col gap-6 rounded-2xl border border-slate-800/80 bg-slate-900/70 p-6 shadow-lg">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold text-slate-100">Chat</h2>
        <p className="text-xs text-slate-400 sm:text-sm">
          Press{" "}
          <kbd className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-[0.65rem]">
            Ctrl
          </kbd>{" "}
          /
          <kbd className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-[0.65rem]">
            ⌘
          </kbd>
          <span className="px-1">+</span>
          <kbd className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-[0.65rem]">
            Enter
          </kbd>
        </p>
      </div>
      <form className="flex flex-1 flex-col gap-4" onSubmit={handleSubmit}>
        <label className="flex flex-col gap-2 text-sm font-medium text-slate-300" htmlFor="message">
          Message
          <textarea
            id="message"
            placeholder="Ask the agent for a summary or instruction..."
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            onKeyDown={(event) => {
              if (!isRunning && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                onRun();
              }
            }}
            className="min-h-[12rem] w-full resize-y rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-base text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/30"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={isRunning}
            className="inline-flex items-center justify-center rounded-full bg-cyan-400 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isRunning ? "Running..." : "Run"}
          </button>
          <span className="text-sm text-slate-400">{status}</span>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
            Final Output
          </h3>
          <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-100">
            {finalOutput || "Results will appear here once the run completes."}
          </pre>
        </div>
      </form>
    </section>
  );
};

const LogFlowPanel: FC<LogFlowPanelProps> = ({ traceId, log, isLoading }) => {
  return (
    <section className="flex h-full flex-col gap-4 rounded-2xl border border-slate-800/80 bg-slate-900/70 p-6 shadow-lg">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold text-slate-100">LogFlow</h2>
        <p className="text-xs text-slate-400 sm:text-sm">
          {traceId ? (
            <span>
              trace_id: <code className="break-all text-cyan-300">{traceId}</code>
            </span>
          ) : (
            "Run the agent to generate a trace."
          )}
        </p>
      </div>
      <pre className="max-h-[28rem] flex-1 overflow-y-auto whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-100">
        {isLoading ? "Loading episode log..." : log || "Logs will appear here when available."}
      </pre>
    </section>
  );
};

const RunPage: NextPage = () => {
  const [message, setMessage] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [finalOutput, setFinalOutput] = useState("");
  const [traceId, setTraceId] = useState<string | null>(null);
  const [log, setLog] = useState("");
  const [isLogLoading, setIsLogLoading] = useState(false);

  const handleRun = useCallback(async () => {
    if (isRunning) {
      return;
    }
    const prompt = message.trim();
    setIsRunning(true);
    setStatus("Running...");
    setFinalOutput("");
    setTraceId(null);
    setLog("");
    setIsLogLoading(false);

    try {
      const response = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: prompt }),
      });

      const payload = (await response.json().catch(() => null)) as
        | ChatSendResponse
        | { message?: string }
        | null;

      if (!response.ok || !payload) {
        const message = typeof (payload as any)?.message === "string" ? (payload as any).message : "Request failed";
        throw new Error(message);
      }

      const data = payload as ChatSendResponse;
      setStatus("Completed");
      setTraceId(data.trace_id);
      setFinalOutput(formatResult(data.result));

      if (data.trace_id) {
        setIsLogLoading(true);
        try {
          const episodeResponse = await fetch(`/api/episodes/${data.trace_id}`);
          if (episodeResponse.ok) {
            const episodeText = await episodeResponse.text();
            const trimmedText = episodeText.trim();
            setLog(trimmedText.length > 0 ? trimmedText : "Episode available but empty.");
          } else {
            setLog("Episode not available yet.");
          }
        } catch {
          setLog("Failed to load episode log.");
        } finally {
          setIsLogLoading(false);
        }
      } else {
        setLog("Trace id was not provided for this run.");
      }
    } catch (error) {
      setStatus("Failed");
      const message = error instanceof Error ? error.message : "Request failed";
      setFinalOutput(message);
      setLog("Run failed before episode log could be retrieved.");
      setIsLogLoading(false);
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, message]);

  return (
    <>
      <Head>
        <title>AgentOS · Run</title>
        <meta
          name="description"
          content="Execute the AgentOS run loop, inspect the final output, and browse the LogFlow episode events."
        />
      </Head>
      <div className="min-h-screen bg-slate-950/95 text-slate-100">
        <header className="border-b border-slate-800/80 bg-slate-950/60 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-8 lg:flex-row lg:items-baseline lg:justify-between">
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold">AgentOS · Chat + LogFlow</h1>
              <p className="text-sm text-slate-400">
                Submit a prompt to generate a response, inspect events, and replay episodes.
              </p>
            </div>
          </div>
        </header>
        <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-6 px-6 py-8 lg:grid-cols-2">
          <ChatPanel
            message={message}
            onMessageChange={setMessage}
            onRun={handleRun}
            isRunning={isRunning}
            status={status}
            finalOutput={finalOutput}
          />
          <LogFlowPanel traceId={traceId} log={log} isLoading={isLogLoading} />
        </main>
      </div>
    </>
  );
};

export default RunPage;

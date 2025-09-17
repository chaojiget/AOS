import type { FC } from "react";

import { useI18n } from "../lib/i18n/index";

export type ChatHistoryMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  ts: string;
  status?: "pending" | "sent" | "done" | "error";
  msgId?: string;
  traceId?: string;
  latencyMs?: number | null;
  cost?: number | null;
  error?: string | null;
};

interface ChatMessageListProps {
  messages: ChatHistoryMessage[];
  isRunning?: boolean;
}

const bubbleStyles: Record<
  ChatHistoryMessage["role"],
  {
    alignSelf: "flex-start" | "flex-end" | "center";
    background: string;
    color: string;
  }
> = {
  user: { alignSelf: "flex-end", background: "#38bdf8", color: "#0f172a" },
  assistant: { alignSelf: "flex-start", background: "#1f2937", color: "#e2e8f0" },
  system: { alignSelf: "center", background: "#334155", color: "#e2e8f0" },
};

const groupMessagesByRole = (messages: ChatHistoryMessage[]) => {
  const groups: Array<{ role: ChatHistoryMessage["role"]; items: ChatHistoryMessage[] }> = [];
  for (const message of messages) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.role === message.role) {
      lastGroup.items.push(message);
    } else {
      groups.push({ role: message.role, items: [message] });
    }
  }
  return groups;
};

const formatTimestamp = (ts: string, locale: string): string => {
  if (!ts) return "";
  try {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) {
      return ts;
    }
    return date.toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
};

const ChatMessageList: FC<ChatMessageListProps> = ({ messages, isRunning = false }) => {
  const { locale, t } = useI18n();
  const groups = groupMessagesByRole(messages);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        maxHeight: 420,
        overflowY: "auto",
        padding: "1rem",
        borderRadius: 12,
        border: "1px solid #1f2937",
        background: "#0f172a",
      }}
    >
      {messages.length === 0 ? (
        <p style={{ margin: 0, color: "#94a3b8" }}>{t("chat.empty")}</p>
      ) : (
        groups.map((group) => {
          const style = bubbleStyles[group.role];
          return (
            <div
              key={`chat-group-${group.items[0]?.id ?? group.role}`}
              data-group-role={group.role}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
                alignItems:
                  style.alignSelf === "center"
                    ? "center"
                    : style.alignSelf === "flex-end"
                      ? "flex-end"
                      : "flex-start",
              }}
            >
              <span
                style={{
                  fontSize: "0.75rem",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "#64748b",
                }}
              >
                {t(`roles.${group.role}`)}
              </span>
              {group.items.map((message) => (
                <article
                  key={message.id}
                  data-role={message.role}
                  data-msg-id={message.msgId ?? undefined}
                  data-status={message.status ?? "sent"}
                  style={{
                    alignSelf: style.alignSelf,
                    background: style.background,
                    color: style.color,
                    borderRadius: 12,
                    padding: "0.75rem 1rem",
                    maxWidth: "82%",
                    boxShadow: "0 4px 12px rgba(15,23,42,0.45)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    border: message.status === "error" ? "1px solid #f97316" : "none",
                  }}
                >
                  <div>{message.content}</div>
                  <footer
                    style={{
                      marginTop: "0.5rem",
                      fontSize: "0.75rem",
                      color: style.color === "#e2e8f0" ? "#cbd5f5" : "#0f172a",
                      opacity: 0.75,
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.15rem",
                    }}
                  >
                    <span>
                      {message.msgId
                        ? `${t("chat.message.labels.msgId")}: ${message.msgId}`
                        : `${t("chat.message.labels.localId")}: ${message.id}`}
                    </span>
                    <span>{formatTimestamp(message.ts, locale)}</span>
                    <span>
                      {message.status === "error"
                        ? (message.error ?? t("chat.message.status.error"))
                        : message.status === "pending"
                          ? t("chat.message.status.pending")
                          : message.status === "done"
                            ? t("chat.message.status.done")
                            : t("chat.message.status.sent")}
                    </span>
                    {message.traceId ? (
                      <span>
                        {t("chat.message.labels.traceId")}: {message.traceId}
                      </span>
                    ) : null}
                    {typeof message.latencyMs === "number" ? (
                      <span>
                        {t("chat.message.labels.latency")}: {message.latencyMs.toFixed(0)} ms
                      </span>
                    ) : null}
                    {typeof message.cost === "number" ? (
                      <span>
                        {t("chat.message.labels.cost")}: {message.cost.toFixed(4)}
                      </span>
                    ) : null}
                  </footer>
                </article>
              ))}
            </div>
          );
        })
      )}
      {isRunning ? (
        <div
          data-role="status"
          style={{
            alignSelf: "flex-start",
            color: "#94a3b8",
            fontStyle: "italic",
          }}
        >
          {t("chat.generating")}
        </div>
      ) : null}
    </div>
  );
};

export default ChatMessageList;

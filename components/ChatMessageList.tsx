import type { FC } from "react";

import { useI18n } from "../lib/i18n/index";
import { badgeClass, chatBubbleVariants, insetSurfaceClass, subtleTextClass } from "../lib/theme";

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
  failureReason?: string | null;
  reviewNotes?: string[] | undefined;
};

interface ChatMessageListProps {
  messages: ChatHistoryMessage[];
  isRunning?: boolean;
}

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
      className={`${insetSurfaceClass} flex max-h-[26rem] flex-col gap-6 overflow-y-auto p-4 md:max-h-none md:min-h-0 md:flex-1`}
      role="log"
      aria-live={isRunning ? "polite" : "off"}
    >
      {messages.length === 0 ? (
        <p className={`${subtleTextClass} m-0 text-center text-sm`}>{t("chat.empty")}</p>
      ) : (
        groups.map((group) => {
          const tone = chatBubbleVariants[group.role];
          return (
            <div
              key={`chat-group-${group.items[0]?.id ?? group.role}`}
              data-group-role={group.role}
              className={`flex flex-col gap-2 ${tone.group}`}
              role="group"
            >
              <span className={`${badgeClass} ${tone.label}`}>{t(`roles.${group.role}`)}</span>
              {group.items.map((message) => {
                const statusLabel =
                  message.status === "error"
                    ? (message.error ?? t("chat.message.status.error"))
                    : message.status === "pending"
                      ? t("chat.message.status.pending")
                      : message.status === "done"
                        ? t("chat.message.status.done")
                        : t("chat.message.status.sent");

                const metadata: string[] = [
                  message.msgId
                    ? `${t("chat.message.labels.msgId")}: ${message.msgId}`
                    : `${t("chat.message.labels.localId")}: ${message.id}`,
                  formatTimestamp(message.ts, locale),
                  statusLabel,
                ];

                if (message.traceId) {
                  metadata.push(`${t("chat.message.labels.traceId")}: ${message.traceId}`);
                }
                if (message.failureReason) {
                  metadata.push(`${t("chat.message.labels.reason")}: ${message.failureReason}`);
                }
                if (message.reviewNotes && message.reviewNotes.length > 0) {
                  const noteSummary = message.reviewNotes.filter(Boolean).join(" · ");
                  metadata.push(`${t("chat.message.labels.reviewNotes")}: ${noteSummary}`);
                }
                if (typeof message.latencyMs === "number") {
                  metadata.push(
                    `${t("chat.message.labels.latency")}: ${message.latencyMs.toFixed(0)} ms`,
                  );
                }
                if (typeof message.cost === "number") {
                  metadata.push(`${t("chat.message.labels.cost")}: ${message.cost.toFixed(4)}`);
                }

                const ringClass =
                  message.status === "error" ? "ring-orange-400/80" : "ring-offset-transparent";

                return (
                  <article
                    key={message.id}
                    data-role={message.role}
                    data-msg-id={message.msgId ?? undefined}
                    data-status={message.status ?? "sent"}
                    className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-relaxed ring-offset-0 transition ${tone.article} ${ringClass}`}
                  >
                    <div className="whitespace-pre-wrap break-words text-left">
                      {message.content}
                    </div>
                    <footer
                      className={`mt-3 flex flex-wrap items-center gap-2 text-[0.7rem] font-medium uppercase tracking-[0.14em] ${tone.meta}`}
                    >
                      {metadata.map((item, index) => (
                        <span
                          key={`${message.id}-meta-${index}`}
                          className={`${badgeClass} ${tone.meta} bg-transparent px-2 py-0 normal-case`}
                        >
                          {item}
                        </span>
                      ))}
                    </footer>
                  </article>
                );
              })}
            </div>
          );
        })
      )}
      {isRunning ? (
        <div data-role="status" className={`${subtleTextClass} italic`}>
          {t("chat.generating")}
        </div>
      ) : null}
    </div>
  );
};

export default ChatMessageList;

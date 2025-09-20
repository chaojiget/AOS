import type { FC } from "react";

import { formatShortId } from "../lib/id";
import { formatFullTimestamp, formatRelativeTimestamp } from "../lib/datetime";
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

                const identifier = message.msgId ?? message.id;
                const identifierLabel = message.msgId
                  ? t("chat.message.labels.msgId")
                  : t("chat.message.labels.localId");
                const relativeTime = formatRelativeTimestamp(message.ts, locale);
                const exactTime = formatFullTimestamp(message.ts, locale);
                const metadataEntries: Array<{
                  key: string;
                  label: string;
                  value: string;
                  title?: string;
                }> = [];

                if (identifier) {
                  metadataEntries.push({
                    key: "identifier",
                    label: identifierLabel,
                    value: formatShortId(identifier),
                    title: identifier,
                  });
                }

                if (relativeTime) {
                  metadataEntries.push({
                    key: "timestamp",
                    label: t("chat.message.labels.timestamp"),
                    value: relativeTime,
                    title: exactTime,
                  });
                }

                metadataEntries.push({
                  key: "status",
                  label: t("chat.message.labels.status"),
                  value: statusLabel,
                });

                if (message.traceId) {
                  metadataEntries.push({
                    key: "traceId",
                    label: t("chat.message.labels.traceId"),
                    value: formatShortId(message.traceId),
                    title: message.traceId,
                  });
                }

                if (typeof message.latencyMs === "number") {
                  metadataEntries.push({
                    key: "latency",
                    label: t("chat.message.labels.latency"),
                    value: `${message.latencyMs.toFixed(0)} ms`,
                  });
                }

                if (typeof message.cost === "number") {
                  metadataEntries.push({
                    key: "cost",
                    label: t("chat.message.labels.cost"),
                    value: message.cost.toFixed(4),
                  });
                }

                if (message.failureReason) {
                  metadataEntries.push({
                    key: "reason",
                    label: t("chat.message.labels.reason"),
                    value: message.failureReason,
                  });
                }

                if (message.reviewNotes && message.reviewNotes.length > 0) {
                  metadataEntries.push({
                    key: "reviewNotes",
                    label: t("chat.message.labels.reviewNotes"),
                    value: message.reviewNotes.filter(Boolean).join("\n"),
                  });
                }

                const ringClass =
                  message.status === "error" ? "ring-orange-400/80" : "ring-offset-transparent";
                const metadataId = `chat-message-${message.id}-metadata`;

                return (
                  <article
                    key={message.id}
                    id={`chat-message-${message.id}`}
                    data-role={message.role}
                    data-msg-id={message.msgId ?? undefined}
                    data-status={message.status ?? "sent"}
                    className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-relaxed ring-offset-0 transition ${tone.article} ${ringClass}`}
                  >
                    <div className="whitespace-pre-wrap break-words text-left">
                      {message.content}
                    </div>
                    {metadataEntries.length > 0 ? (
                      <details
                        className="mt-3 text-[0.7rem]"
                        aria-label={t("chat.message.metadata.summary")}
                      >
                        <summary
                          className="flex cursor-pointer select-none items-center gap-2 font-semibold uppercase tracking-[0.14em] text-slate-500 outline-none transition hover:text-slate-700 focus-visible:text-slate-700"
                          aria-controls={metadataId}
                        >
                          <span>{t("chat.message.metadata.summary")}</span>
                        </summary>
                        <dl id={metadataId} className="mt-2 space-y-2 text-left text-[0.7rem]">
                          {metadataEntries.map((item) => (
                            <div
                              key={`${message.id}-${item.key}`}
                              className="flex flex-col gap-0.5"
                            >
                              <dt className="font-semibold uppercase tracking-[0.14em] text-slate-500">
                                {item.label}
                              </dt>
                              <dd
                                className="whitespace-pre-line break-words font-mono text-slate-700"
                                title={item.title}
                                aria-label={item.title ? `${item.label}: ${item.title}` : undefined}
                              >
                                {item.value}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </details>
                    ) : null}
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

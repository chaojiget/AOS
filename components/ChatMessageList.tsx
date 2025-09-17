import type { FC } from "react";

interface ChatMessageListProps {
  messages: Array<{ role: string; content: string }>;
  isRunning?: boolean;
}

const bubbleStyles: Record<
  string,
  { alignSelf: "flex-start" | "flex-end" | "center"; background: string }
> = {
  user: { alignSelf: "flex-end", background: "#38bdf8" },
  assistant: { alignSelf: "flex-start", background: "#334155" },
  system: { alignSelf: "center", background: "#475569" },
};

const ChatMessageList: FC<ChatMessageListProps> = ({ messages, isRunning = false }) => {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        maxHeight: 360,
        overflowY: "auto",
        padding: "1rem",
        borderRadius: 8,
        border: "1px solid #1f2937",
        background: "#0f172a",
      }}
    >
      {messages.length === 0 ? (
        <p style={{ margin: 0, color: "#94a3b8" }}>No messages yet.</p>
      ) : (
        messages.map((message, index) => {
          const style = bubbleStyles[message.role] ?? bubbleStyles.assistant;
          return (
            <div
              key={`chat-message-${index}`}
              data-role={message.role}
              style={{
                alignSelf: style.alignSelf,
                background: style.background,
                color: message.role === "user" ? "#0f172a" : "#e2e8f0",
                borderRadius: 12,
                padding: "0.75rem 1rem",
                maxWidth: "80%",
                boxShadow: "0 4px 12px rgba(15,23,42,0.45)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {message.content}
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
          Generating response…
        </div>
      ) : null}
    </div>
  );
};

export default ChatMessageList;

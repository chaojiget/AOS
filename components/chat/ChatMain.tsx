import type { ChangeEvent, FC, FormEventHandler, KeyboardEvent } from "react";

import ChatMessageList, { type ChatHistoryMessage } from "../ChatMessageList";
import {
  badgeClass,
  insetSurfaceClass,
  inputSurfaceClass,
  labelClass,
  panelSurfaceClass,
  primaryButtonClass,
  subtleTextClass,
} from "../../lib/theme";

interface ChatMainProps {
  panelTitle: string;
  statusToneClass: string;
  statusText: string;
  traceId?: string | null;
  messages: ChatHistoryMessage[];
  isRunning: boolean;
  finalPreview?: string | null;
  finalPreviewLabel: string;
  inputLabel: string;
  inputPlaceholder: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onRunShortcut: () => void | Promise<void>;
  submitLabel: string;
  submitDisabled?: boolean;
  helperText: string;
}

const ChatMain: FC<ChatMainProps> = ({
  panelTitle,
  statusToneClass,
  statusText,
  traceId,
  messages,
  isRunning,
  finalPreview,
  finalPreviewLabel,
  inputLabel,
  inputPlaceholder,
  inputValue,
  onInputChange,
  onSubmit,
  onRunShortcut,
  submitLabel,
  submitDisabled,
  helperText,
}) => {
  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onInputChange(event.target.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void onRunShortcut();
    }
  };

  return (
    <section
      aria-labelledby="conversation-title"
      className={`${panelSurfaceClass} space-y-6 p-6 sm:p-8`}
      data-testid="conversation-panel"
    >
      <h3 id="conversation-title" className="sr-only">
        {panelTitle}
      </h3>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={`${badgeClass} ${statusToneClass} bg-transparent normal-case`}>
          {statusText}
        </span>
        {traceId ? (
          <span className="font-mono text-xs text-slate-400 sm:text-sm">{traceId}</span>
        ) : null}
      </div>

      <ChatMessageList messages={messages} isRunning={isRunning} />

      {finalPreview ? (
        <div className={`${insetSurfaceClass} border border-sky-500/40 bg-sky-500/5 p-4`}>
          <div className={`${labelClass} text-sky-200`}>{finalPreviewLabel}</div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-100">{finalPreview}</p>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="space-y-4">
        <label htmlFor="prompt" className={`${labelClass} text-slate-300`}>
          {inputLabel}
        </label>
        <textarea
          id="prompt"
          value={inputValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={inputPlaceholder}
          className={`${inputSurfaceClass} min-h-[9rem] w-full resize-y`}
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="submit"
            disabled={submitDisabled}
            className={`${primaryButtonClass} w-full sm:w-auto`}
          >
            {submitLabel}
          </button>
          <span className={`${subtleTextClass} text-sm`}>{helperText}</span>
        </div>
      </form>
    </section>
  );
};

export default ChatMain;

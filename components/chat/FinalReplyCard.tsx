import type { FC } from "react";

import { useI18n } from "../../lib/i18n";
import {
  insetSurfaceClass,
  labelClass,
  outlineButtonClass,
  subtleTextClass,
} from "../../lib/theme";

interface FinalReplyCardProps {
  label: string;
  content: string;
  sticky?: boolean;
  historyCount?: number;
  anchorId?: string | null;
  onCopy?: () => void;
  onLocate?: () => void;
  onOpenHistory?: () => void;
}

const FinalReplyCard: FC<FinalReplyCardProps> = ({
  label,
  content,
  sticky = false,
  historyCount = 0,
  anchorId,
  onCopy,
  onLocate,
  onOpenHistory,
}) => {
  const { t } = useI18n();

  if (!content) {
    return null;
  }

  return (
    <div
      className={
        sticky ? "sticky top-0 z-20 space-y-3 bg-slate-950/70 pb-3 pt-1 backdrop-blur" : undefined
      }
      aria-live="polite"
    >
      <div
        className={`${insetSurfaceClass} border border-sky-500/40 bg-sky-500/10 p-4 shadow-[0_20px_50px_rgba(56,189,248,0.18)]`}
        data-testid="final-reply-card"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={`${labelClass} text-sky-200`}>{label}</span>
          <div className="flex flex-wrap items-center gap-2">
            {onCopy ? (
              <button
                type="button"
                onClick={onCopy}
                className={`${outlineButtonClass} px-3 py-1 text-xs`}
              >
                {t("conversation.finalReply.copy")}
              </button>
            ) : null}
            {onLocate ? (
              <button
                type="button"
                onClick={onLocate}
                className={`${outlineButtonClass} px-3 py-1 text-xs`}
                aria-controls={anchorId ? `chat-message-${anchorId}` : undefined}
              >
                {t("conversation.finalReply.locate")}
              </button>
            ) : null}
            {onOpenHistory ? (
              <button
                type="button"
                onClick={onOpenHistory}
                className={`${outlineButtonClass} px-3 py-1 text-xs`}
              >
                {t("conversation.finalReply.history", { count: historyCount })}
              </button>
            ) : null}
          </div>
        </div>
        <p className={`${subtleTextClass} mt-2 whitespace-pre-wrap text-sm text-slate-100`}>
          {content}
        </p>
      </div>
    </div>
  );
};

export default FinalReplyCard;

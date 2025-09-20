import { useCallback, useState, type ReactNode } from "react";

import { outlineButtonClass } from "../lib/theme";

export type LocalToastTone = "info" | "success" | "error";

export interface LocalToastOptions {
  title?: string;
  message: ReactNode;
  dismissLabel?: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: LocalToastTone;
}

interface UseLocalToastResult {
  showToast: (options: LocalToastOptions) => void;
  dismissToast: () => void;
  ToastContainer: () => JSX.Element | null;
}

const toneStyles: Record<LocalToastTone, { container: string; title: string }> = {
  info: {
    container: "border-sky-500/40 bg-sky-500/10 text-sky-100",
    title: "text-sky-200",
  },
  success: {
    container: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
    title: "text-emerald-200",
  },
  error: {
    container: "border-amber-500/40 bg-amber-500/10 text-amber-100",
    title: "text-amber-200",
  },
};

export function useLocalToast(initialToast: LocalToastOptions | null = null): UseLocalToastResult {
  const [toast, setToast] = useState<LocalToastOptions | null>(initialToast);

  const showToast = useCallback((options: LocalToastOptions) => {
    setToast({ ...options });
  }, []);

  const dismissToast = useCallback(() => {
    setToast(null);
  }, []);

  const ToastContainer = useCallback(() => {
    if (!toast) return null;

    const tone = toast.tone ?? "error";
    const styles = toneStyles[tone];

    const handleAction = () => {
      dismissToast();
      toast.onAction?.();
    };

    return (
      <div
        className={`fixed bottom-6 left-1/2 z-50 w-[min(420px,calc(100%-2rem))] -translate-x-1/2 rounded-lg border p-4 shadow-lg backdrop-blur ${styles.container}`}
        role="alert"
        data-tone={tone}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            {toast.title ? (
              <h3 className={`text-sm font-semibold ${styles.title}`}>{toast.title}</h3>
            ) : null}
            <div className="mt-1 text-sm leading-relaxed">{toast.message}</div>
          </div>
          {toast.dismissLabel ? (
            <button
              type="button"
              className="text-sm text-current opacity-80 transition hover:opacity-100"
              onClick={dismissToast}
            >
              {toast.dismissLabel}
            </button>
          ) : null}
        </div>
        {toast.actionLabel && toast.onAction ? (
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className={outlineButtonClass} onClick={handleAction}>
              {toast.actionLabel}
            </button>
          </div>
        ) : null}
      </div>
    );
  }, [dismissToast, toast]);

  return { showToast, dismissToast, ToastContainer };
}

export default useLocalToast;

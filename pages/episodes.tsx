import Head from "next/head";
import type { NextPage } from "next";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  headerSurfaceClass,
  headingClass,
  insetSurfaceClass,
  labelClass,
  outlineButtonClass,
  pageContainerClass,
  panelSurfaceClass,
  primaryButtonClass,
  shellClass,
  subtleTextClass,
} from "../lib/theme";
import {
  fetchEpisodes,
  fetchEpisodeDetail,
  replayEpisode,
  type EpisodeDetailResponse,
  type EpisodeListItem,
  type EpisodeReplayResponse,
} from "../lib/episodes";
import { useI18n } from "../lib/i18n/index";
import { useLocalToast } from "../components/useLocalToast";

type ListState = {
  isLoading: boolean;
  error: string | null;
  items: EpisodeListItem[];
};

type DetailState = {
  isLoading: boolean;
  error: string | null;
  detail: EpisodeDetailResponse["data"] | null;
};

type ReplayState = {
  isReplaying: boolean;
  result: EpisodeReplayResponse["data"] | null;
  error: string | null;
};

const skeletonItems = new Array(6).fill(null);

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString();
}

const EpisodesPage: NextPage = () => {
  const [listState, setListState] = useState<ListState>({
    isLoading: true,
    error: null,
    items: [],
  });
  const [detailState, setDetailState] = useState<DetailState>({
    isLoading: false,
    error: null,
    detail: null,
  });
  const [replayState, setReplayState] = useState<ReplayState>({
    isReplaying: false,
    result: null,
    error: null,
  });
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const { t } = useI18n();
  const { ToastContainer, showToast, dismissToast } = useLocalToast();

  const loadEpisodes = useCallback(async () => {
    setListState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const response = await fetchEpisodes();
      const items = response.data.items;
      setListState({ isLoading: false, error: null, items });
      if (items.length > 0) {
        setSelectedTraceId((previous) => {
          if (previous && items.some((item) => item.trace_id === previous)) {
            return previous;
          }
          return items[0].trace_id;
        });
      } else {
        setSelectedTraceId(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载 Episodes 列表时发生未知错误";
      setListState({ isLoading: false, error: message, items: [] });
      showToast({
        title: t("toast.error.title"),
        message,
        dismissLabel: t("toast.dismiss"),
        actionLabel: t("toast.action.retry"),
        onAction: () => {
          void loadEpisodes();
        },
        tone: "error",
      });
    }
  }, [showToast, t]);

  const loadDetail = useCallback(
    async (traceId: string) => {
      setDetailState({ isLoading: true, error: null, detail: null });
      setReplayState({ isReplaying: false, result: null, error: null });
      try {
        const response = await fetchEpisodeDetail(traceId);
        setDetailState({ isLoading: false, error: null, detail: response.data });
      } catch (error) {
        const message = error instanceof Error ? error.message : "加载 Episode 详情时发生未知错误";
        setDetailState({ isLoading: false, error: message, detail: null });
        showToast({
          title: t("toast.error.title"),
          message,
          dismissLabel: t("toast.dismiss"),
          actionLabel: t("toast.action.retry"),
          onAction: () => {
            void loadDetail(traceId);
          },
          tone: "error",
        });
      }
    },
    [showToast, t],
  );

  useEffect(() => {
    loadEpisodes();
  }, [loadEpisodes]);

  useEffect(() => {
    if (selectedTraceId) {
      loadDetail(selectedTraceId);
    }
  }, [selectedTraceId, loadDetail]);

  const handleSelect = useCallback(
    (traceId: string) => {
      setSelectedTraceId(traceId);
      dismissToast();
    },
    [dismissToast],
  );

  const handleReplay = useCallback(async () => {
    if (!selectedTraceId) return;
    setReplayState({ isReplaying: true, result: null, error: null });
    try {
      const response = await replayEpisode(selectedTraceId, { mode: "deterministic" });
      setReplayState({ isReplaying: false, result: response.data, error: null });
      dismissToast();
    } catch (error) {
      const message = error instanceof Error ? error.message : "回放 Episode 时发生未知错误";
      setReplayState({ isReplaying: false, result: null, error: message });
      showToast({
        title: t("toast.error.title"),
        message,
        dismissLabel: t("toast.dismiss"),
        actionLabel: t("toast.action.retry"),
        onAction: () => {
          void handleReplay();
        },
        tone: "error",
      });
    }
  }, [dismissToast, selectedTraceId, showToast, t]);

  const selectedDetail = detailState.detail;

  const replaySummary = useMemo(() => {
    if (replayState.result) {
      return `原始 ${replayState.result.score_before ?? "N/A"} / 回放 ${
        replayState.result.score_after ?? "N/A"
      } / 差值 ${replayState.result.diff ?? 0}`;
    }
    return null;
  }, [replayState.result]);

  return (
    <div className={shellClass}>
      <Head>
        <title>Episodes · Agent OS</title>
      </Head>
      <main className={`${pageContainerClass} gap-6`}>
        <header className={`${headerSurfaceClass} flex items-center justify-between`}>
          <div>
            <h1 className={headingClass}>Episodes</h1>
            <p className={subtleTextClass}>回放日志、验证得分漂移，快速定位问题运行。</p>
          </div>
          <button type="button" className={outlineButtonClass} onClick={loadEpisodes}>
            刷新列表
          </button>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(260px,320px)_1fr] xl:grid-cols-[360px_1fr]">
          <aside className={`${panelSurfaceClass} flex flex-col gap-4 p-4`}>
            <div className="flex items-center justify-between">
              <h2 className={`${headingClass} text-base`}>运行记录</h2>
              <span className={`${labelClass} text-xs text-slate-300/70`}>
                {listState.items.length} runs
              </span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {listState.isLoading ? (
                <ul className="flex flex-col gap-3" data-testid="episodes-skeleton">
                  {skeletonItems.map((_, index) => (
                    <li
                      key={index}
                      className="animate-pulse rounded-md border border-slate-700/60 bg-slate-800/60 p-3"
                    >
                      <div className="h-4 w-2/3 rounded bg-slate-700/70" />
                      <div className="mt-3 h-3 w-1/2 rounded bg-slate-700/50" />
                    </li>
                  ))}
                </ul>
              ) : listState.error ? (
                <div className={`${insetSurfaceClass} p-4 text-sm text-rose-200`}>
                  {listState.error}
                </div>
              ) : listState.items.length === 0 ? (
                <div className={`${insetSurfaceClass} p-4 text-sm text-slate-300/80`}>
                  暂无 Episodes，先通过聊天或脚本触发一次运行。
                </div>
              ) : (
                <ul className="flex flex-col gap-3" data-testid="episodes-list">
                  {listState.items.map((item) => {
                    const isSelected = item.trace_id === selectedTraceId;
                    return (
                      <li key={item.trace_id}>
                        <button
                          type="button"
                          onClick={() => handleSelect(item.trace_id)}
                          className={`${isSelected ? "border-sky-500/70" : "border-transparent"} ${
                            isSelected ? "bg-sky-500/5" : "bg-slate-800/60 hover:bg-slate-800/80"
                          } w-full rounded-md border p-3 text-left transition-colors`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-medium text-slate-100">
                              {item.goal ?? item.trace_id}
                            </span>
                            <span className={`text-xs ${subtleTextClass}`}>{item.status}</span>
                          </div>
                          <div className="mt-2 text-xs text-slate-300/80">
                            {formatRelativeTime(item.started_at)}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>

          <section className={`${panelSurfaceClass} flex flex-col gap-4 p-4`}>
            {selectedTraceId ? (
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <h2 className={`${headingClass} text-base`}>Episode {selectedTraceId}</h2>
                  {selectedDetail?.goal ? (
                    <span className={subtleTextClass}>目标：{selectedDetail.goal}</span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className={primaryButtonClass}
                  onClick={handleReplay}
                  disabled={replayState.isReplaying}
                >
                  {replayState.isReplaying ? "回放中..." : "触发回放"}
                </button>
              </div>
            ) : (
              <div className="text-sm text-slate-300/80">请选择左侧的 Episode 查看详情。</div>
            )}

            {detailState.isLoading ? (
              <div className="flex flex-col gap-4" data-testid="episode-detail-skeleton">
                <div className="h-5 w-1/3 animate-pulse rounded bg-slate-700/60" />
                <div className={`grid gap-3 md:grid-cols-2`}>
                  <div className="h-4 animate-pulse rounded bg-slate-700/50" />
                  <div className="h-4 animate-pulse rounded bg-slate-700/50" />
                  <div className="h-4 animate-pulse rounded bg-slate-700/50" />
                  <div className="h-4 animate-pulse rounded bg-slate-700/50" />
                </div>
                <div
                  className={`${insetSurfaceClass} h-48 animate-pulse rounded-lg bg-slate-800/60`}
                />
              </div>
            ) : detailState.error ? (
              <div className={`${insetSurfaceClass} p-4 text-sm text-rose-200`}>
                {detailState.error}
              </div>
            ) : selectedDetail ? (
              <div className="flex flex-col gap-4" data-testid="episode-detail">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <span className={labelClass}>运行状态</span>
                    <span className="text-sm text-slate-100">{selectedDetail.status}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={labelClass}>开始时间</span>
                    <span className="text-sm text-slate-100">
                      {formatRelativeTime(selectedDetail.started_at)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={labelClass}>结束时间</span>
                    <span className="text-sm text-slate-100">
                      {selectedDetail.finished_at
                        ? formatRelativeTime(selectedDetail.finished_at)
                        : "—"}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={labelClass}>步骤数</span>
                    <span className="text-sm text-slate-100">{selectedDetail.step_count ?? 0}</span>
                  </div>
                </div>

                {replayState.result ? (
                  <div className={`${insetSurfaceClass} flex flex-col gap-2 p-4`}>
                    <span className={labelClass}>回放结果</span>
                    <span className="text-sm text-slate-100">{replaySummary}</span>
                  </div>
                ) : null}

                {replayState.error ? (
                  <div className={`${insetSurfaceClass} p-3 text-sm text-rose-200`}>
                    {replayState.error}
                  </div>
                ) : null}

                <div
                  className={`${insetSurfaceClass} max-h-[320px] overflow-y-auto rounded-lg`}
                  data-testid="episode-events"
                >
                  <table className="min-w-full text-left text-sm text-slate-200/90">
                    <thead>
                      <tr className="border-b border-slate-700/70 text-xs uppercase tracking-wide text-slate-300/80">
                        <th className="px-3 py-2">时间</th>
                        <th className="px-3 py-2">类型</th>
                        <th className="px-3 py-2">数据摘要</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedDetail.events.map((event) => (
                        <tr key={event.id} className="border-b border-slate-800/50 last:border-0">
                          <td className="px-3 py-2 align-top text-xs text-slate-300/80">
                            {formatRelativeTime(event.ts)}
                          </td>
                          <td className="px-3 py-2 align-top text-xs font-medium text-slate-100">
                            {event.type}
                          </td>
                          <td className="px-3 py-2 align-top text-xs text-slate-200">
                            <pre className="max-h-32 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-300/90">
                              {JSON.stringify(event.data ?? null, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className={`${insetSurfaceClass} p-4 text-sm text-slate-300/80`}>
                暂无详细信息。
              </div>
            )}
          </section>
        </section>
      </main>

      <ToastContainer />
    </div>
  );
};

export default EpisodesPage;

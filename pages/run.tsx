import Head from "next/head";
import type { NextPage } from "next";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";

import ErrorCard from "../components/ErrorCard";
import HeaderPrimaryNav, { type HeaderPrimaryNavItem } from "../components/HeaderPrimaryNav";
import LogFlowPanel from "../components/LogFlowPanel";
import {
  fetchEpisodeDetail,
  fetchEpisodes,
  type EpisodeDetailResponse,
  type EpisodeEvent,
  type EpisodeListItem,
} from "../lib/episodes";
import { useI18n } from "../lib/i18n";
import {
  badgeClass,
  headerSurfaceClass,
  headingClass,
  inputSurfaceClass,
  insetSurfaceClass,
  labelClass,
  outlineButtonClass,
  pageContainerClass,
  panelSurfaceClass,
  shellClass,
  subtleTextClass,
} from "../lib/theme";

interface RunListState {
  isLoading: boolean;
  error: string | null;
  items: EpisodeListItem[];
}

interface RunDetailState {
  isLoading: boolean;
  error: string | null;
  detail: EpisodeDetailResponse["data"] | null;
}

const skeletonItems = new Array(6).fill(null);

const formatTimestamp = (value: string | null | undefined): string => {
  if (!value) return "–";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
};

const summariseEvent = (event: EpisodeEvent): string | null => {
  if (!event?.data) return null;
  if (typeof event.data === "string") {
    return event.data;
  }
  if (typeof event.data === "object") {
    const message = (event.data as any)?.message ?? (event.data as any)?.text;
    if (typeof message === "string") {
      return message;
    }
    try {
      return JSON.stringify(event.data);
    } catch {
      return String(event.data);
    }
  }
  return String(event.data);
};

const RunPage: NextPage = () => {
  const router = useRouter();
  const { t } = useI18n();
  const [listState, setListState] = useState<RunListState>({
    isLoading: true,
    error: null,
    items: [],
  });
  const [detailState, setDetailState] = useState<RunDetailState>({
    isLoading: false,
    error: null,
    detail: null,
  });
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const navItems = useMemo<HeaderPrimaryNavItem[]>(
    () =>
      [
        { href: "/", label: t("layout.nav.chat") },
        { href: "/run", label: t("layout.nav.runs") },
        { href: "/episodes", label: t("layout.nav.episodes") },
        { href: "/skills", label: t("layout.nav.skills") },
      ].map((item) => ({
        ...item,
        isActive: router.pathname === item.href,
      })),
    [router.pathname, t],
  );

  const loadRuns = useCallback(async () => {
    setListState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const response = await fetchEpisodes();
      const items = response.data.items;
      setListState({ isLoading: false, error: null, items });
      setSelectedTraceId((current) => {
        if (current && items.some((item) => item.trace_id === current)) {
          return current;
        }
        return items[0]?.trace_id ?? null;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("runs.list.error");
      setListState({ isLoading: false, error: message, items: [] });
      setSelectedTraceId(null);
    }
  }, [t]);

  const loadDetail = useCallback(
    async (traceId: string) => {
      setDetailState({ isLoading: true, error: null, detail: null });
      try {
        const response = await fetchEpisodeDetail(traceId);
        setDetailState({ isLoading: false, error: null, detail: response.data });
      } catch (error) {
        const message = error instanceof Error ? error.message : t("runs.timeline.error");
        setDetailState({ isLoading: false, error: message, detail: null });
      }
    },
    [t],
  );

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (selectedTraceId) {
      loadDetail(selectedTraceId);
    }
  }, [selectedTraceId, loadDetail]);

  const filteredItems = useMemo(() => {
    const normalised = searchTerm.trim().toLowerCase();
    if (!normalised) {
      return listState.items;
    }
    return listState.items.filter((item) => {
      const tokens = [item.goal, item.trace_id, item.status]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return tokens.includes(normalised);
    });
  }, [listState.items, searchTerm]);

  const pageTitle = `${t("runs.heading")} · Agent OS`;
  const subtitle = t("runs.subtitle");
  const listHeading = t("runs.list.heading");
  const listEmpty = t("runs.list.empty");
  const listError = listState.error ?? t("runs.list.error");
  const listRetry = t("runs.list.retry");
  const listRefresh = t("runs.list.refresh");
  const searchPlaceholder = t("runs.list.searchPlaceholder");
  const timelineHeading = t("runs.timeline.heading");
  const timelineEmpty = t("runs.timeline.empty");
  const metaStartedLabel = t("runs.timeline.meta.startedAt");
  const metaFinishedLabel = t("runs.timeline.meta.finishedAt");
  const metaStatusLabel = t("runs.timeline.meta.status");
  const errorBack = t("errors.generic.secondary");
  const runNotFoundTitle = t("errors.runNotFound.title");
  const runNotFoundDescription = t("errors.runNotFound.description");
  const runNotFoundPrimary = t("errors.runNotFound.primary");
  const runNotFoundSecondary = t("errors.runNotFound.secondary");

  const selectedDetail = detailState.detail;
  const selectedEvents = selectedDetail?.events ?? [];

  return (
    <div className={shellClass}>
      <Head>
        <title>{pageTitle}</title>
      </Head>
      <main className={`${pageContainerClass} space-y-6`}>
        <header className={`${headerSurfaceClass} space-y-4 p-6 sm:p-8`}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <h1 className={`${headingClass} text-2xl`}>{t("runs.heading")}</h1>
              <p className={`${subtleTextClass} text-sm`}>{subtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => loadRuns()}
              className={`${outlineButtonClass} w-full sm:w-auto`}
              disabled={listState.isLoading}
            >
              {listState.isLoading ? t("runs.list.loading") : listRefresh}
            </button>
          </div>
          <HeaderPrimaryNav
            items={navItems}
            ariaLabel={t("layout.primaryNavLabel")}
            className="justify-center"
          />
        </header>

        <section className="grid gap-6 xl:grid-cols-shell">
          <aside className={`${panelSurfaceClass} flex flex-col gap-4 p-6`}>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className={`${headingClass} text-base`}>{listHeading}</h2>
                <span className={`${labelClass} text-xs text-slate-300/70`}>
                  {listState.items.length}
                </span>
              </div>
              <label className="flex flex-col gap-2 text-sm">
                <span className={`${labelClass} text-slate-400`}>{searchPlaceholder}</span>
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder={searchPlaceholder}
                  className={`${inputSurfaceClass} w-full`}
                  data-testid="run-search"
                />
              </label>
            </div>
            <div className="flex-1 overflow-y-auto">
              {listState.isLoading ? (
                <ul className="flex flex-col gap-3" data-testid="run-list-skeleton">
                  {skeletonItems.map((_, index) => (
                    <li
                      key={index}
                      className="animate-pulse rounded-2xl border border-slate-800/70 bg-slate-900/60 p-4"
                    >
                      <div className="h-4 w-3/5 rounded bg-slate-800/70" />
                      <div className="mt-3 h-3 w-1/2 rounded bg-slate-800/50" />
                    </li>
                  ))}
                </ul>
              ) : listState.error ? (
                <ErrorCard
                  title={listError}
                  description={subtitle}
                  actions={[
                    {
                      label: listRetry,
                      onClick: () => loadRuns(),
                    },
                    {
                      label: errorBack,
                      onClick: () => {
                        void router.push("/");
                      },
                    },
                  ]}
                />
              ) : filteredItems.length === 0 ? (
                <div className={`${insetSurfaceClass} p-4 text-sm text-slate-300/80`}>
                  {listEmpty}
                </div>
              ) : (
                <ul className="flex flex-col gap-3" data-testid="run-list">
                  {filteredItems.map((item) => {
                    const isSelected = item.trace_id === selectedTraceId;
                    return (
                      <li key={item.trace_id}>
                        <button
                          type="button"
                          onClick={() => setSelectedTraceId(item.trace_id)}
                          className={`${
                            isSelected
                              ? "border-sky-500/70 bg-sky-500/10 text-sky-100"
                              : "border-transparent bg-slate-900/60 text-slate-200 hover:bg-slate-900/80"
                          } flex w-full flex-col gap-2 rounded-2xl border px-4 py-3 text-left transition`}
                          data-testid="run-list-item"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold">
                              {item.goal ?? t("conversation.episodes.untitled")}
                            </span>
                            <span className={`${badgeClass} text-xs uppercase tracking-[0.18em]`}>
                              {item.status}
                            </span>
                          </div>
                          <p className={`${subtleTextClass} text-xs font-mono`}>{item.trace_id}</p>
                          <p className={`${subtleTextClass} text-xs`}>
                            {metaStartedLabel}: {formatTimestamp(item.started_at)}
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>

          <section className={`${panelSurfaceClass} flex flex-col gap-6 p-6`}>
            <header className="space-y-2">
              <h2 className={`${headingClass} text-xl`}>{timelineHeading}</h2>
              {selectedDetail ? (
                <dl className="grid gap-1 text-xs uppercase tracking-[0.18em] text-slate-300">
                  <div className="flex items-center gap-2">
                    <dt className={`${badgeClass} bg-transparent px-2 py-0`}>{metaStatusLabel}</dt>
                    <dd>{selectedDetail.status ?? "–"}</dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <dt className={`${badgeClass} bg-transparent px-2 py-0`}>{metaStartedLabel}</dt>
                    <dd>{formatTimestamp(selectedDetail.started_at)}</dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <dt className={`${badgeClass} bg-transparent px-2 py-0`}>
                      {metaFinishedLabel}
                    </dt>
                    <dd>{formatTimestamp(selectedDetail.finished_at ?? null)}</dd>
                  </div>
                </dl>
              ) : null}
            </header>

            {detailState.isLoading ? (
              <div className="space-y-3" data-testid="run-timeline-skeleton">
                {skeletonItems.slice(0, 4).map((_, index) => (
                  <div
                    key={index}
                    className="animate-pulse rounded-2xl border border-slate-800/70 bg-slate-900/60 p-4"
                  >
                    <div className="h-4 w-1/4 rounded bg-slate-800/70" />
                    <div className="mt-2 h-3 w-2/3 rounded bg-slate-800/50" />
                    <div className="mt-2 h-3 w-full rounded bg-slate-800/40" />
                  </div>
                ))}
              </div>
            ) : detailState.error ? (
              <ErrorCard
                title={runNotFoundTitle}
                description={runNotFoundDescription}
                actions={[
                  {
                    label: runNotFoundPrimary,
                    onClick: () => {
                      void router.push("/");
                    },
                  },
                  {
                    label: runNotFoundSecondary,
                    onClick: () => loadRuns(),
                  },
                ]}
              />
            ) : selectedEvents.length === 0 ? (
              <div className={`${insetSurfaceClass} p-6 text-center text-sm text-slate-300/80`}>
                {timelineEmpty}
              </div>
            ) : (
              <ol className="space-y-4" data-testid="run-timeline">
                {selectedEvents.map((event) => (
                  <li
                    key={event.id}
                    className={`${insetSurfaceClass} space-y-3 border-slate-800/60 p-4`}
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.18em]">
                      <span className={`${badgeClass} bg-sky-500/10 text-sky-100`}>
                        {event.type}
                      </span>
                      {event.level ? (
                        <span className={`${badgeClass} text-amber-200/90`}>{event.level}</span>
                      ) : null}
                      <span className={`${badgeClass} text-slate-300`}>
                        {new Date(event.ts).toLocaleString()}
                      </span>
                    </div>
                    {event.topic ? (
                      <p className={`${subtleTextClass} text-xs`}>topic: {event.topic}</p>
                    ) : null}
                    {summariseEvent(event) ? (
                      <p className={`${subtleTextClass} text-sm leading-relaxed`}>
                        {summariseEvent(event)}
                      </p>
                    ) : null}
                    {event.data ? (
                      <details className="group">
                        <summary className="cursor-pointer text-xs text-sky-200">payload</summary>
                        <pre className="mt-2 max-h-60 overflow-auto rounded-xl bg-slate-950/70 p-3 text-xs text-slate-200">
                          {typeof event.data === "string"
                            ? event.data
                            : JSON.stringify(event.data, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <aside className={`${panelSurfaceClass} space-y-6 p-6`}>
            <section className="space-y-3">
              <h2 className={`${headingClass} text-lg`}>{t("runs.inspector.planHeading")}</h2>
              <ul className="space-y-2 text-sm text-slate-200">
                <li className={`${insetSurfaceClass} border-slate-800/60 p-3`}>
                  <p className="font-semibold">Define goal & constraints</p>
                  <p className={`${subtleTextClass} text-xs`}>
                    Validate guardrails before executing tools.
                  </p>
                </li>
                <li className={`${insetSurfaceClass} border-slate-800/60 p-3`}>
                  <p className="font-semibold">Collect supporting evidence</p>
                  <p className={`${subtleTextClass} text-xs`}>
                    Aggregate documents and prior episodes to support the final answer.
                  </p>
                </li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className={`${headingClass} text-lg`}>{t("runs.inspector.skillsHeading")}</h2>
              <ul className="space-y-2 text-sm text-slate-200">
                <li className={`${insetSurfaceClass} border-slate-800/60 p-3`}>
                  <div className={`${badgeClass} bg-sky-500/10 text-sky-100`}>web.search</div>
                  <p className={`${subtleTextClass} mt-2 text-xs`}>
                    Resolved factual lookup to confirm budget assumptions.
                  </p>
                </li>
                <li className={`${insetSurfaceClass} border-slate-800/60 p-3`}>
                  <div className={`${badgeClass} bg-sky-500/10 text-sky-100`}>code.diff</div>
                  <p className={`${subtleTextClass} mt-2 text-xs`}>
                    Compared recent commit against baseline to surface risky changes.
                  </p>
                </li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className={`${headingClass} text-lg`}>{t("runs.inspector.logHeading")}</h2>
              <LogFlowPanel traceId={selectedTraceId ?? undefined} />
            </section>
          </aside>
        </section>
      </main>
    </div>
  );
};

export default RunPage;

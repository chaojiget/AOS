import Head from "next/head";
import Link from "next/link";
import type { NextPage } from "next";
import { useCallback, useEffect, useState } from "react";

import {
  badgeClass,
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
  fetchSkillsOverview,
  setSkillEnabled,
  triggerSkillsAnalysis,
  type SkillMetadata,
  type SkillsOverview,
} from "../lib/skills";

type SkillsState = {
  isLoading: boolean;
  error: string | null;
  overview: SkillsOverview;
};

type ToggleRequest = { id: string; enabled: boolean };

const emptyOverview: SkillsOverview = { enabled: [], candidates: [] };

function formatWinRate(value: number): string {
  const percentage = Math.round((value ?? 0) * 1000) / 10;
  return `${percentage.toFixed(1)}%`;
}

const SkillsPage: NextPage = () => {
  const [state, setState] = useState<SkillsState>({
    isLoading: true,
    error: null,
    overview: emptyOverview,
  });
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [isAnalysing, setIsAnalysing] = useState<boolean>(false);

  const loadOverview = useCallback(async () => {
    setState((previous) => ({ ...previous, isLoading: true, error: null }));
    try {
      const overview = await fetchSkillsOverview();
      setState({ isLoading: false, error: null, overview });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "An unexpected error occurred while loading skills";
      setState({ isLoading: false, error: message, overview: emptyOverview });
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const handleToggle = useCallback(async (payload: ToggleRequest) => {
    setMutatingId(payload.id);
    try {
      const overview = await setSkillEnabled(payload.id, payload.enabled);
      setState({ isLoading: false, error: null, overview });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "An unexpected error occurred while updating the skill";
      setState((previous) => ({ ...previous, error: message }));
    } finally {
      setMutatingId(null);
    }
  }, []);

  const handleAnalyze = useCallback(async () => {
    setIsAnalysing(true);
    try {
      const result = await triggerSkillsAnalysis();
      setState((previous) => ({
        isLoading: false,
        error: null,
        overview: { enabled: previous.overview.enabled, candidates: result.candidates },
      }));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "An unexpected error occurred while analysing skills";
      setState((previous) => ({ ...previous, error: message }));
    } finally {
      setIsAnalysing(false);
    }
  }, []);

  const renderSkillCard = (skill: SkillMetadata, options: { showToggle: boolean }) => {
    const winRateLabel = formatWinRate(skill.winRate);
    const usageLabel = `${skill.usedCount} ${skill.usedCount === 1 ? "use" : "uses"}`;
    const reviewLabel = skill.reviewStatus.replace("_", " ");
    return (
      <li
        key={skill.id}
        className={`${insetSurfaceClass} flex flex-col gap-3 p-5`}
        data-testid="skill-card"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className={`${headingClass} text-base`}>{skill.name}</h2>
            <span className={subtleTextClass}>{skill.description}</span>
          </div>
          <div className="flex flex-col items-end gap-2 text-right">
            <span className={labelClass}>Review</span>
            <span className={badgeClass}>{reviewLabel}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {skill.category ? <span className={badgeClass}>#{skill.category}</span> : null}
            {skill.tags?.map((tag) => (
              <span key={tag} className={badgeClass}>
                {tag}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-4 text-sm text-slate-200/80">
            <span>
              <span className="font-medium">Usage:</span> {usageLabel}
            </span>
            <span>
              <span className="font-medium">Win rate:</span> {winRateLabel}
            </span>
          </div>
        </div>
        {options.showToggle ? (
          <div className="flex justify-end">
            <button
              type="button"
              disabled={mutatingId === skill.id}
              className={skill.enabled ? outlineButtonClass : primaryButtonClass}
              onClick={() => handleToggle({ id: skill.id, enabled: !skill.enabled })}
            >
              {mutatingId === skill.id ? "Updating..." : skill.enabled ? "Disable" : "Enable"}
            </button>
          </div>
        ) : null}
      </li>
    );
  };

  const renderSection = (
    title: string,
    skills: SkillMetadata[],
    options: { showToggle: boolean; emptyLabel: string; description: string },
  ) => {
    return (
      <section className={`${panelSurfaceClass} flex flex-col gap-6 p-8`}>
        <header className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h2 className={`${headingClass} text-xl`}>{title}</h2>
            <p className={subtleTextClass}>{options.description}</p>
          </div>
        </header>
        {skills.length === 0 ? (
          <p className={subtleTextClass}>{options.emptyLabel}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {skills.map((skill) => renderSkillCard(skill, options))}
          </ul>
        )}
      </section>
    );
  };

  return (
    <div className={shellClass}>
      <Head>
        <title>Skills | AOS</title>
      </Head>
      <header className={`${headerSurfaceClass} sticky top-0 z-10`}>
        <div className={`${pageContainerClass} flex items-center justify-between py-6`}>
          <div className="flex flex-col gap-1">
            <span className={labelClass}>Operations</span>
            <h1 className={`${headingClass} text-2xl`}>Skills</h1>
          </div>
          <nav className="flex items-center gap-3">
            <Link href="/" className={outlineButtonClass}>
              Home
            </Link>
            <Link href="/run" className={primaryButtonClass}>
              Launch Run
            </Link>
          </nav>
        </div>
      </header>
      <main className={`${pageContainerClass} flex flex-col gap-6`}>
        <section className={`${panelSurfaceClass} flex flex-col gap-4 p-8`}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className={subtleTextClass}>
              Review the generated skills, trigger new analyses, and toggle approved capabilities.
            </p>
            <button
              type="button"
              className={primaryButtonClass}
              onClick={handleAnalyze}
              disabled={isAnalysing}
            >
              {isAnalysing ? "Analysing..." : "Analyse recent runs"}
            </button>
          </div>
          {state.error ? (
            <div
              className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
              role="alert"
            >
              {state.error}
            </div>
          ) : null}
          {state.isLoading ? (
            <p className={subtleTextClass}>Loading skills...</p>
          ) : (
            <div className="flex flex-col gap-6">
              {renderSection("Candidate skills", state.overview.candidates, {
                showToggle: false,
                description: "Skills awaiting manual review before rollout.",
                emptyLabel:
                  "No candidate skills available. Trigger an analysis run to populate this list.",
              })}
              {renderSection("Enabled skills", state.overview.enabled, {
                showToggle: true,
                description: "Approved skills currently available to the agent.",
                emptyLabel: "No enabled skills found.",
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default SkillsPage;

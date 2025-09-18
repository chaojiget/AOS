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
import type { SkillMetadata } from "../lib/skills";

type SkillsState = {
  isLoading: boolean;
  error: string | null;
  items: SkillMetadata[];
};

type SkillsResponse = { skills?: SkillMetadata[]; skill?: SkillMetadata; message?: string };

type ToggleRequest = { id: string; enabled: boolean };

const SkillsPage: NextPage = () => {
  const [state, setState] = useState<SkillsState>({ isLoading: true, error: null, items: [] });
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const loadSkills = async () => {
      try {
        const response = await fetch("/api/skills");
        const payload: SkillsResponse | null = await response.json().catch(() => null);
        if (!response.ok || !payload || !Array.isArray(payload.skills)) {
          throw new Error(payload?.message ?? "Failed to load skills");
        }
        if (!isMounted) return;
        setState({ isLoading: false, error: null, items: payload.skills });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "An unexpected error occurred while loading skills";
        if (!isMounted) return;
        setState({ isLoading: false, error: message, items: [] });
      }
    };

    loadSkills();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleToggle = useCallback(async (payload: ToggleRequest) => {
    setMutatingId(payload.id);
    try {
      const response = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data: SkillsResponse | null = await response.json().catch(() => null);
      if (!response.ok || !data) {
        throw new Error(data?.message ?? "Failed to update skill status");
      }
      setState((previous) => {
        if (Array.isArray(data.skills)) {
          return { isLoading: false, error: null, items: data.skills };
        }
        if (data.skill) {
          return {
            isLoading: false,
            error: null,
            items: previous.items.map((skill) =>
              skill.id === data.skill?.id ? data.skill! : skill,
            ),
          };
        }
        return previous;
      });
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

  const renderSkills = () => {
    if (state.isLoading) {
      return <p className={subtleTextClass}>Loading skills...</p>;
    }

    if (state.items.length === 0) {
      return <p className={subtleTextClass}>No skills are currently registered.</p>;
    }

    return (
      <ul className="flex flex-col gap-4">
        {state.items.map((skill) => {
          const isMutating = mutatingId === skill.id;
          const actionLabel = skill.enabled ? "Disable" : "Enable";
          const buttonClass = skill.enabled ? outlineButtonClass : primaryButtonClass;
          const statusLabel = skill.enabled ? "Enabled" : "Disabled";

          return (
            <li
              key={skill.id}
              className={`${insetSurfaceClass} flex flex-col gap-3 p-5`}
              data-testid="skill-card"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <h2 className={`${headingClass} text-base`}>{skill.name}</h2>
                  <span className={subtleTextClass}>{skill.description}</span>
                </div>
                <div className="flex flex-col items-end gap-2 text-right">
                  <span className={labelClass}>Status</span>
                  <span className={badgeClass} data-testid="skill-status">
                    {statusLabel}
                  </span>
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
                <button
                  type="button"
                  disabled={isMutating}
                  className={buttonClass}
                  onClick={() => handleToggle({ id: skill.id, enabled: !skill.enabled })}
                >
                  {isMutating ? "Updating..." : actionLabel}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
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
        <section className={`${panelSurfaceClass} flex flex-col gap-6 p-8`}>
          <div className="flex flex-col gap-2">
            <p className={subtleTextClass}>
              Review the currently registered skills, toggle their availability, and jump into a run
              to verify changes instantly.
            </p>
          </div>
          {state.error ? (
            <div
              className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
              role="alert"
            >
              {state.error}
            </div>
          ) : null}
          {renderSkills()}
        </section>
      </main>
    </div>
  );
};

export default SkillsPage;

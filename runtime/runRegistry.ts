import type { EpisodeLogger } from "./episode";
import type { EventBus } from "./events";

export type RunStatus = "running" | "completed" | "failed";

export interface RunEntry {
  runId: string;
  bus: EventBus;
  logger: EpisodeLogger;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
}

const CLEANUP_DELAY_MS = 5 * 60_000;

interface InternalRunEntry extends RunEntry {
  cleanupTimer?: NodeJS.Timeout;
}

const runs = new Map<string, InternalRunEntry>();

export function registerRun(
  runId: string,
  options: {
    bus: EventBus;
    logger: EpisodeLogger;
  },
): RunEntry {
  const existing = runs.get(runId);
  if (existing?.cleanupTimer) {
    clearTimeout(existing.cleanupTimer);
  }

  const entry: InternalRunEntry = {
    runId,
    bus: options.bus,
    logger: options.logger,
    status: "running",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  runs.set(runId, entry);
  return entry;
}

export function getRun(runId: string): RunEntry | undefined {
  return runs.get(runId);
}

function scheduleCleanup(runId: string, entry: InternalRunEntry): void {
  if (entry.cleanupTimer) {
    clearTimeout(entry.cleanupTimer);
  }
  entry.cleanupTimer = setTimeout(() => {
    const current = runs.get(runId);
    if (current === entry) {
      runs.delete(runId);
    }
  }, CLEANUP_DELAY_MS);
  entry.cleanupTimer.unref?.();
}

function updateStatus(runId: string, status: RunStatus): void {
  const entry = runs.get(runId);
  if (!entry) {
    return;
  }
  entry.status = status;
  entry.updatedAt = Date.now();
  if (status !== "running") {
    scheduleCleanup(runId, entry);
  }
}

export function markRunCompleted(runId: string): void {
  updateStatus(runId, "completed");
}

export function markRunFailed(runId: string): void {
  updateStatus(runId, "failed");
}

export function removeRun(runId: string): void {
  const entry = runs.get(runId);
  if (!entry) {
    return;
  }
  if (entry.cleanupTimer) {
    clearTimeout(entry.cleanupTimer);
  }
  runs.delete(runId);
}

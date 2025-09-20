import { resolveApiBaseUrl, buildAuthHeaders, getLocalApp } from "../run";
import { EpisodesService } from "../../../servers/api/src/episodes/episodes.service";

interface ListOptions {
  page?: number;
  pageSize?: number;
}

export function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return undefined;
}

export async function fetchRemoteEpisodesList(options: ListOptions = {}): Promise<Response | null> {
  const apiBase = resolveApiBaseUrl();
  if (!apiBase) {
    return null;
  }
  const headers = buildAuthHeaders();
  const url = new URL(`${apiBase}/episodes`);
  if (options.page) {
    url.searchParams.set("page", String(options.page));
  }
  if (options.pageSize) {
    url.searchParams.set("page_size", String(options.pageSize));
  }
  try {
    return await fetch(url, { headers });
  } catch {
    return null;
  }
}

export async function fetchRemoteEpisodeDetail(traceId: string): Promise<Response | null> {
  const apiBase = resolveApiBaseUrl();
  if (!apiBase) {
    return null;
  }
  const headers = buildAuthHeaders();
  try {
    return await fetch(`${apiBase}/episodes/${encodeURIComponent(traceId)}`, { headers });
  } catch {
    return null;
  }
}

export async function postRemoteEpisodeReplay(traceId: string, payload: any): Promise<Response | null> {
  const apiBase = resolveApiBaseUrl();
  if (!apiBase) {
    return null;
  }
  const headers = buildAuthHeaders();
  try {
    return await fetch(`${apiBase}/episodes/${encodeURIComponent(traceId)}/replay`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload ?? {}),
    });
  } catch {
    return null;
  }
}

async function getEpisodesService(): Promise<EpisodesService> {
  const app = await getLocalApp();
  return app.get(EpisodesService);
}

export async function listEpisodesLocally(options: ListOptions = {}) {
  const service = await getEpisodesService();
  return service.listEpisodes(options);
}

export async function getEpisodeLocally(traceId: string) {
  const service = await getEpisodesService();
  return service.getEpisode(traceId);
}

export async function replayEpisodeLocally(traceId: string, payload: any) {
  const service = await getEpisodesService();
  return service.replayEpisode(traceId, payload ?? {});
}

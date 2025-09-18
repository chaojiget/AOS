export interface SkillDto {
  id: string;
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  enabled: boolean;
  template_json?: Record<string, unknown>;
  used_count?: number;
  win_rate?: number;
  review_status?: string;
  last_analyzed_at?: string;
}

export type SkillReviewStatus = "draft" | "pending_review" | "approved" | "rejected";

export interface SkillMetadata {
  id: string;
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  enabled: boolean;
  templateJson: Record<string, unknown>;
  usedCount: number;
  winRate: number;
  reviewStatus: SkillReviewStatus;
  lastAnalyzedAt?: string;
}

export interface SkillsOverview {
  enabled: SkillMetadata[];
  candidates: SkillMetadata[];
}

export interface SkillsAnalyzeResponse {
  ok: boolean;
  analyzed: number;
  candidates: SkillMetadata[];
}

interface SkillsApiListResponse {
  skills: SkillDto[];
}

interface SkillsCandidatesResponse {
  candidates: SkillDto[];
}

const API_BASE = process.env.NEXT_PUBLIC_AOS_API_BASE ?? "";

function resolveUrl(path: string): string {
  if (path.startsWith("http")) {
    return path;
  }
  return `${API_BASE}${path}`;
}

async function parseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

function normaliseSkillDto(raw: unknown): SkillMetadata | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as SkillDto;
  if (typeof candidate.id !== "string" || typeof candidate.name !== "string") {
    return null;
  }
  if (typeof candidate.description !== "string") {
    return null;
  }
  const reviewStatus =
    candidate.review_status === "draft" ||
    candidate.review_status === "pending_review" ||
    candidate.review_status === "approved" ||
    candidate.review_status === "rejected"
      ? (candidate.review_status as SkillReviewStatus)
      : "pending_review";
  const tags = Array.isArray(candidate.tags)
    ? candidate.tags.filter((tag): tag is string => typeof tag === "string" && tag.length > 0)
    : undefined;
  const template =
    typeof candidate.template_json === "object" && candidate.template_json !== null
      ? (candidate.template_json as Record<string, unknown>)
      : {};
  const usedCount =
    typeof candidate.used_count === "number" && Number.isFinite(candidate.used_count)
      ? Math.max(0, Math.floor(candidate.used_count))
      : 0;
  const winRate =
    typeof candidate.win_rate === "number" && Number.isFinite(candidate.win_rate)
      ? Math.min(1, Math.max(0, candidate.win_rate))
      : 0;
  const lastAnalyzedAt =
    typeof candidate.last_analyzed_at === "string" && candidate.last_analyzed_at.length > 0
      ? candidate.last_analyzed_at
      : undefined;

  return {
    id: candidate.id,
    name: candidate.name,
    description: candidate.description,
    enabled: Boolean(candidate.enabled),
    category: typeof candidate.category === "string" ? candidate.category : undefined,
    tags,
    templateJson: JSON.parse(JSON.stringify(template)),
    usedCount,
    winRate,
    reviewStatus,
    ...(lastAnalyzedAt ? { lastAnalyzedAt } : {}),
  } satisfies SkillMetadata;
}

function normaliseSkillList(list?: SkillDto[]): SkillMetadata[] {
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .map((item) => normaliseSkillDto(item))
    .filter((item): item is SkillMetadata => item !== null);
}

export async function fetchEnabledSkills(): Promise<SkillMetadata[]> {
  const response = await fetch(resolveUrl("/api/skills"), { headers: { Accept: "application/json" } });
  const payload = await parseJson<SkillsApiListResponse>(response);
  return normaliseSkillList(payload.skills);
}

export async function fetchCandidateSkills(): Promise<SkillMetadata[]> {
  const response = await fetch(resolveUrl("/api/skills/candidates"), {
    headers: { Accept: "application/json" },
  });
  const payload = await parseJson<SkillsCandidatesResponse>(response);
  return normaliseSkillList(payload.candidates);
}

export async function fetchSkillsOverview(): Promise<SkillsOverview> {
  const [enabled, candidates] = await Promise.all([fetchEnabledSkills(), fetchCandidateSkills()]);
  return { enabled, candidates } satisfies SkillsOverview;
}

export async function setSkillEnabled(id: string, enabled: boolean): Promise<SkillsOverview> {
  const response = await fetch(resolveUrl("/api/skills"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ id, enabled }),
  });
  await parseJson<unknown>(response);
  return fetchSkillsOverview();
}

export async function triggerSkillsAnalysis(): Promise<SkillsAnalyzeResponse> {
  const response = await fetch(resolveUrl("/api/skills/analyze"), {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  const payload = await parseJson<{ ok: boolean; analyzed: number; candidates: SkillDto[] }>(response);
  return {
    ok: Boolean(payload.ok),
    analyzed: typeof payload.analyzed === "number" ? payload.analyzed : 0,
    candidates: normaliseSkillList(payload.candidates),
  } satisfies SkillsAnalyzeResponse;
}

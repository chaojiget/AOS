import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type ReviewStatus = "draft" | "pending_review" | "approved" | "rejected";

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  enabled: boolean;
  template_json: Record<string, unknown>;
  used_count: number;
  win_rate: number;
  review_status: ReviewStatus;
  last_analyzed_at?: string;
}

export class SkillNotFoundError extends Error {
  constructor(id: string) {
    super(`Skill with id "${id}" was not found`);
    this.name = "SkillNotFoundError";
  }
}

export const DEFAULT_SKILLS: SkillRecord[] = [
  {
    id: "csv.clean",
    name: "CSV Cleaner",
    description: "Normalise and sanitise CSV datasets for downstream tooling.",
    category: "data",
    tags: ["csv", "preprocess"],
    enabled: true,
    template_json: {},
    used_count: 0,
    win_rate: 0,
    review_status: "approved",
  },
  {
    id: "stats.aggregate",
    name: "Stats Aggregate",
    description: "Compute descriptive statistics across structured tabular inputs.",
    category: "analytics",
    tags: ["statistics", "report"],
    enabled: true,
    template_json: {},
    used_count: 0,
    win_rate: 0,
    review_status: "approved",
  },
  {
    id: "md.render",
    name: "Markdown Renderer",
    description: "Render Markdown knowledge cards into enriched HTML blocks.",
    category: "rendering",
    tags: ["markdown", "ui"],
    enabled: false,
    template_json: {},
    used_count: 0,
    win_rate: 0,
    review_status: "pending_review",
  },
];

let memorySkills: SkillRecord[] = cloneSkills(DEFAULT_SKILLS);

function cloneSkill(record: SkillRecord): SkillRecord {
  return {
    ...record,
    ...(record.tags ? { tags: [...record.tags] } : {}),
    template_json: JSON.parse(JSON.stringify(record.template_json ?? {})),
  };
}

function cloneSkills(skills: SkillRecord[]): SkillRecord[] {
  return skills.map((skill) => cloneSkill(skill));
}

const getSkillsStorePath = (): string =>
  process.env.AOS_SKILLS_PATH ?? join(process.cwd(), "runtime", "skills.json");

async function readFromFile(): Promise<SkillRecord[] | null> {
  const filePath = getSkillsStorePath();
  try {
    const payload = await readFile(filePath, "utf8");
    const parsed = JSON.parse(payload);
    if (!Array.isArray(parsed)) {
      return null;
    }
    const normalised = parsed
      .map((entry) => normaliseSkill(entry))
      .filter((entry): entry is SkillRecord => entry !== null);
    if (normalised.length === 0) {
      return null;
    }
    return normalised;
  } catch (error) {
    return null;
  }
}

function normaliseSkill(raw: unknown): SkillRecord | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  const description =
    typeof candidate.description === "string" ? candidate.description.trim() : "";
  if (!id || !name || !description) {
    return null;
  }

  const enabledValue = candidate.enabled;
  const enabled = typeof enabledValue === "boolean" ? enabledValue : true;
  const category =
    typeof candidate.category === "string" && candidate.category.trim().length > 0
      ? candidate.category.trim()
      : undefined;
  const tags = Array.isArray(candidate.tags)
    ? candidate.tags.filter((tag): tag is string => typeof tag === "string" && tag.length > 0)
    : undefined;
  const templateValue =
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
  const reviewStatus = isReviewStatus(candidate.review_status)
    ? candidate.review_status
    : "pending_review";
  const lastAnalyzedAt =
    typeof candidate.last_analyzed_at === "string" && candidate.last_analyzed_at.length > 0
      ? candidate.last_analyzed_at
      : undefined;

  return {
    id,
    name,
    description,
    enabled,
    template_json: JSON.parse(JSON.stringify(templateValue)),
    used_count: usedCount,
    win_rate: winRate,
    review_status: reviewStatus,
    ...(category ? { category } : {}),
    ...(tags && tags.length > 0 ? { tags: [...tags] } : {}),
    ...(lastAnalyzedAt ? { last_analyzed_at: lastAnalyzedAt } : {}),
  };
}

function isReviewStatus(value: unknown): value is ReviewStatus {
  return value === "draft" || value === "pending_review" || value === "approved" || value === "rejected";
}

async function persistSkills(skills: SkillRecord[]): Promise<void> {
  const filePath = getSkillsStorePath();
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(skills, null, 2), "utf8");
  } catch (error) {
    console.warn("Failed to persist skills store", error);
  }
}

async function ensureMemoryStore(): Promise<SkillRecord[]> {
  const stored = await readFromFile();
  if (stored) {
    memorySkills = cloneSkills(stored);
  }
  return memorySkills;
}

export async function listSkills(): Promise<SkillRecord[]> {
  const skills = await ensureMemoryStore();
  return cloneSkills(skills);
}

export async function listCandidateSkills(): Promise<SkillRecord[]> {
  const skills = await ensureMemoryStore();
  return cloneSkills(skills.filter((skill) => skill.review_status !== "approved"));
}

export async function getSkillById(id: string): Promise<SkillRecord | null> {
  const skills = await ensureMemoryStore();
  const match = skills.find((skill) => skill.id === id);
  return match ? cloneSkill(match) : null;
}

export async function setSkillEnabled(id: string, enabled: boolean): Promise<SkillRecord> {
  const skills = await ensureMemoryStore();
  const match = skills.find((skill) => skill.id === id);
  if (!match) {
    throw new SkillNotFoundError(id);
  }
  match.enabled = enabled;
  await persistSkills(skills);
  return cloneSkill(match);
}

export async function upsertSkills(records: SkillRecord[]): Promise<SkillRecord[]> {
  const skills = await ensureMemoryStore();
  for (const record of records) {
    const index = skills.findIndex((skill) => skill.id === record.id);
    if (index >= 0) {
      skills[index] = cloneSkill({ ...skills[index], ...record });
    } else {
      skills.push(cloneSkill(record));
    }
  }
  await persistSkills(skills);
  return cloneSkills(skills);
}

export async function resetSkillsStore(options?: {
  skills?: SkillRecord[];
  persist?: boolean;
}): Promise<void> {
  const { skills = DEFAULT_SKILLS, persist = false } = options ?? {};
  memorySkills = cloneSkills(skills);
  const filePath = getSkillsStorePath();
  if (!persist) {
    await rm(filePath, { force: true });
    return;
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(skills, null, 2), "utf8");
}

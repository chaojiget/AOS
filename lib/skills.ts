import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface SkillMetadata {
  id: string;
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  enabled: boolean;
}

export class SkillNotFoundError extends Error {
  constructor(id: string) {
    super(`Skill with id "${id}" was not found`);
    this.name = "SkillNotFoundError";
  }
}

const DEFAULT_SKILLS: SkillMetadata[] = [
  {
    id: "csv.clean",
    name: "CSV Cleaner",
    description: "Normalise and sanitise CSV datasets for downstream tooling.",
    category: "data",
    tags: ["csv", "preprocess"],
    enabled: true,
  },
  {
    id: "stats.aggregate",
    name: "Stats Aggregate",
    description: "Compute descriptive statistics across structured tabular inputs.",
    category: "analytics",
    tags: ["statistics", "report"],
    enabled: true,
  },
  {
    id: "md.render",
    name: "Markdown Renderer",
    description: "Render Markdown knowledge cards into enriched HTML blocks.",
    category: "rendering",
    tags: ["markdown", "ui"],
    enabled: false,
  },
];

let memorySkills: SkillMetadata[] = cloneSkills(DEFAULT_SKILLS);

const getSkillsStorePath = (): string =>
  process.env.AOS_SKILLS_PATH ?? join(process.cwd(), "runtime", "skills.json");

function cloneSkill(skill: SkillMetadata): SkillMetadata {
  const cloned: SkillMetadata = {
    ...skill,
    ...(skill.tags ? { tags: [...skill.tags] } : {}),
  };
  return cloned;
}

function cloneSkills(skills: SkillMetadata[]): SkillMetadata[] {
  return skills.map((skill) => cloneSkill(skill));
}

function normaliseSkill(raw: unknown): SkillMetadata | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  const description = typeof candidate.description === "string" ? candidate.description.trim() : "";
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

  return {
    id,
    name,
    description,
    enabled,
    ...(category ? { category } : {}),
    ...(tags && tags.length > 0 ? { tags: [...tags] } : {}),
  };
}

async function readFromFile(): Promise<SkillMetadata[] | null> {
  const filePath = getSkillsStorePath();
  try {
    const payload = await readFile(filePath, "utf8");
    const parsed = JSON.parse(payload);
    if (!Array.isArray(parsed)) {
      return null;
    }
    const normalised = parsed
      .map((entry) => normaliseSkill(entry))
      .filter((entry): entry is SkillMetadata => entry !== null);
    if (normalised.length === 0) {
      return null;
    }
    return normalised;
  } catch (error) {
    return null;
  }
}

async function persistSkills(skills: SkillMetadata[]): Promise<void> {
  const filePath = getSkillsStorePath();
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(skills, null, 2), "utf8");
  } catch (error) {
    console.warn("Failed to persist skills store", error);
  }
}

async function ensureMemoryStore(): Promise<SkillMetadata[]> {
  const stored = await readFromFile();
  if (stored) {
    memorySkills = cloneSkills(stored);
  }
  return memorySkills;
}

export async function listSkills(): Promise<SkillMetadata[]> {
  const skills = await ensureMemoryStore();
  return cloneSkills(skills);
}

export async function setSkillEnabled(id: string, enabled: boolean): Promise<SkillMetadata> {
  const skills = await ensureMemoryStore();
  const match = skills.find((skill) => skill.id === id);
  if (!match) {
    throw new SkillNotFoundError(id);
  }
  match.enabled = enabled;
  await persistSkills(skills);
  return cloneSkill(match);
}

export async function resetSkillsStore(options?: {
  skills?: SkillMetadata[];
  persist?: boolean;
}): Promise<void> {
  const { skills = DEFAULT_SKILLS, persist = false } = options ?? {};
  memorySkills = cloneSkills(skills);
  const filePath = getSkillsStorePath();
  if (!persist) {
    await rm(filePath, { force: true });
    return;
  }
  await persistSkills(memorySkills);
}

export { DEFAULT_SKILLS };

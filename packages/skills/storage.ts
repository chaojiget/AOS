import { randomUUID } from "node:crypto";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq, sql } from "drizzle-orm";

import * as schema from "../../servers/api/src/database/schema";

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

export interface SkillUpdateStats {
  totalCount: number;
  successCount: number;
  failureCount: number;
  newEventCount: number;
  newSuccessCount: number;
  newFailureCount: number;
  lastEventAt?: string;
}

export interface SkillUpsertContext {
  runId?: string;
  stats?: Map<string, SkillUpdateStats>;
}

export interface SkillsRepository {
  list(): Promise<SkillRecord[]>;
  findById(id: string): Promise<SkillRecord | null>;
  upsert(records: SkillRecord[], context?: SkillUpsertContext): Promise<SkillRecord[]>;
  setEnabled(id: string, enabled: boolean): Promise<SkillRecord>;
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

export function createSqliteSkillsRepository(
  db: BetterSQLite3Database<typeof schema>,
  options: { seedDefaults?: boolean } = {},
): SkillsRepository {
  return new SqliteSkillsRepository(db, options);
}

export class SqliteSkillsRepository implements SkillsRepository {
  private readonly db: BetterSQLite3Database<typeof schema>;
  private readonly seedDefaults: boolean;
  private defaultsPromise: Promise<void> | null = null;

  constructor(db: BetterSQLite3Database<typeof schema>, options: { seedDefaults?: boolean } = {}) {
    this.db = db;
    this.seedDefaults = options.seedDefaults ?? true;
  }

  async list(): Promise<SkillRecord[]> {
    await this.ensureDefaults();
    const rows = await this.db.select().from(schema.skills).orderBy(schema.skills.name);
    return rows.map((row) => deserializeSkill(row));
  }

  async findById(id: string): Promise<SkillRecord | null> {
    await this.ensureDefaults();
    const rows = await this.db
      .select()
      .from(schema.skills)
      .where(eq(schema.skills.id, id))
      .limit(1);
    const match = rows[0];
    return match ? deserializeSkill(match) : null;
  }

  async setEnabled(id: string, enabled: boolean): Promise<SkillRecord> {
    await this.ensureDefaults();
    const updatedAt = new Date();
    await this.db.update(schema.skills).set({ enabled, updatedAt }).where(eq(schema.skills.id, id));
    const row = await this.findById(id);
    if (!row) {
      throw new SkillNotFoundError(id);
    }
    return row;
  }

  async upsert(records: SkillRecord[], context?: SkillUpsertContext): Promise<SkillRecord[]> {
    await this.ensureDefaults();
    if (records.length === 0) {
      return this.list();
    }
    const runId = context?.runId ?? randomUUID();
    const now = new Date();

    await this.db.transaction(async (tx) => {
      for (const record of records) {
        const existing = await tx
          .select()
          .from(schema.skills)
          .where(eq(schema.skills.id, record.id))
          .limit(1);
        const existingRow = existing[0] ?? null;
        const version = (existingRow?.version ?? 0) + 1;
        const versionId = randomUUID();
        const createdAt = existingRow?.createdAt ?? now;
        const lastAnalyzedAtDate = parseDate(record.last_analyzed_at);

        await tx
          .insert(schema.skills)
          .values({
            id: record.id,
            name: record.name,
            description: record.description,
            category: record.category ?? null,
            tags: record.tags ? JSON.stringify(record.tags) : null,
            enabled: record.enabled,
            template: JSON.stringify(record.template_json ?? {}),
            usedCount: record.used_count,
            winRate: record.win_rate,
            reviewStatus: record.review_status,
            lastAnalyzedAt: lastAnalyzedAtDate,
            createdAt,
            updatedAt: now,
            version,
            currentVersionId: versionId,
          })
          .onConflictDoUpdate({
            target: schema.skills.id,
            set: {
              name: record.name,
              description: record.description,
              category: record.category ?? null,
              tags: record.tags ? JSON.stringify(record.tags) : null,
              enabled: record.enabled,
              template: JSON.stringify(record.template_json ?? {}),
              usedCount: record.used_count,
              winRate: record.win_rate,
              reviewStatus: record.review_status,
              lastAnalyzedAt: lastAnalyzedAtDate,
              updatedAt: now,
              version,
              currentVersionId: versionId,
            },
          });

        await tx.insert(schema.skillVersions).values({
          id: versionId,
          skillId: record.id,
          version,
          name: record.name,
          description: record.description,
          category: record.category ?? null,
          tags: record.tags ? JSON.stringify(record.tags) : null,
          template: JSON.stringify(record.template_json ?? {}),
          usedCount: record.used_count,
          winRate: record.win_rate,
          reviewStatus: record.review_status,
          lastAnalyzedAt: lastAnalyzedAtDate,
          createdAt: now,
        });

        const stats = context?.stats?.get(record.id);
        if (stats) {
          await tx.insert(schema.skillRuns).values({
            id: randomUUID(),
            skillId: record.id,
            version,
            runId,
            totalCount: stats.totalCount,
            successCount: stats.successCount,
            failureCount: stats.failureCount,
            newEventCount: stats.newEventCount,
            newSuccessCount: stats.newSuccessCount,
            newFailureCount: stats.newFailureCount,
            lastEventAt: parseDate(stats.lastEventAt),
            createdAt: now,
          });
        }
      }
    });

    return this.list();
  }

  private async ensureDefaults(): Promise<void> {
    if (!this.seedDefaults) {
      return;
    }
    if (!this.defaultsPromise) {
      this.defaultsPromise = this.db.transaction(async (tx) => {
        const countResult = await tx
          .select({ value: sql<number>`count(*)`.as("value") })
          .from(schema.skills)
          .limit(1);
        const count = countResult[0]?.value ?? 0;
        if (count > 0) {
          return;
        }
        const now = new Date();
        for (const record of DEFAULT_SKILLS) {
          const versionId = randomUUID();
          const lastAnalyzedAt = parseDate(record.last_analyzed_at);
          await tx.insert(schema.skills).values({
            id: record.id,
            name: record.name,
            description: record.description,
            category: record.category ?? null,
            tags: record.tags ? JSON.stringify(record.tags) : null,
            enabled: record.enabled,
            template: JSON.stringify(record.template_json ?? {}),
            usedCount: record.used_count,
            winRate: record.win_rate,
            reviewStatus: record.review_status,
            lastAnalyzedAt,
            createdAt: now,
            updatedAt: now,
            version: 1,
            currentVersionId: versionId,
          });
          await tx.insert(schema.skillVersions).values({
            id: versionId,
            skillId: record.id,
            version: 1,
            name: record.name,
            description: record.description,
            category: record.category ?? null,
            tags: record.tags ? JSON.stringify(record.tags) : null,
            template: JSON.stringify(record.template_json ?? {}),
            usedCount: record.used_count,
            winRate: record.win_rate,
            reviewStatus: record.review_status,
            lastAnalyzedAt,
            createdAt: now,
          });
        }
      });
    }
    await this.defaultsPromise;
  }
}

export function createInMemorySkillsRepository(
  initial: SkillRecord[] = DEFAULT_SKILLS,
): SkillsRepository {
  return new InMemorySkillsRepository(initial);
}

export class InMemorySkillsRepository implements SkillsRepository {
  private records: Map<string, SkillRecord>;

  constructor(initial: SkillRecord[] = DEFAULT_SKILLS) {
    this.records = new Map(initial.map((record) => [record.id, cloneSkill(record)]));
  }

  async list(): Promise<SkillRecord[]> {
    return [...this.records.values()].map((record) => cloneSkill(record));
  }

  async findById(id: string): Promise<SkillRecord | null> {
    const match = this.records.get(id);
    return match ? cloneSkill(match) : null;
  }

  async setEnabled(id: string, enabled: boolean): Promise<SkillRecord> {
    const match = this.records.get(id);
    if (!match) {
      throw new SkillNotFoundError(id);
    }
    match.enabled = enabled;
    return cloneSkill(match);
  }

  async upsert(records: SkillRecord[]): Promise<SkillRecord[]> {
    for (const record of records) {
      this.records.set(record.id, cloneSkill(record));
    }
    return this.list();
  }
}

export async function resetSkillsStore(
  db: BetterSQLite3Database<typeof schema>,
  options: { skills?: SkillRecord[] } = {},
): Promise<void> {
  const skills = options.skills ?? DEFAULT_SKILLS;
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.delete(schema.skillRuns);
    await tx.delete(schema.skillVersions);
    await tx.delete(schema.skills);
    for (const record of skills) {
      const versionId = randomUUID();
      const lastAnalyzedAt = parseDate(record.last_analyzed_at);
      await tx.insert(schema.skills).values({
        id: record.id,
        name: record.name,
        description: record.description,
        category: record.category ?? null,
        tags: record.tags ? JSON.stringify(record.tags) : null,
        enabled: record.enabled,
        template: JSON.stringify(record.template_json ?? {}),
        usedCount: record.used_count,
        winRate: record.win_rate,
        reviewStatus: record.review_status,
        lastAnalyzedAt,
        createdAt: now,
        updatedAt: now,
        version: 1,
        currentVersionId: versionId,
      });
      await tx.insert(schema.skillVersions).values({
        id: versionId,
        skillId: record.id,
        version: 1,
        name: record.name,
        description: record.description,
        category: record.category ?? null,
        tags: record.tags ? JSON.stringify(record.tags) : null,
        template: JSON.stringify(record.template_json ?? {}),
        usedCount: record.used_count,
        winRate: record.win_rate,
        reviewStatus: record.review_status,
        lastAnalyzedAt,
        createdAt: now,
      });
    }
  });
}

function cloneSkill(record: SkillRecord): SkillRecord {
  return {
    ...record,
    ...(record.category ? { category: record.category } : {}),
    ...(record.tags ? { tags: [...record.tags] } : {}),
    template_json: JSON.parse(JSON.stringify(record.template_json ?? {})),
    ...(record.last_analyzed_at ? { last_analyzed_at: record.last_analyzed_at } : {}),
  };
}

function deserializeSkill(row: typeof schema.skills.$inferSelect): SkillRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category ?? undefined,
    tags: row.tags ? (JSON.parse(row.tags) as string[]) : undefined,
    enabled: Boolean(row.enabled),
    template_json: row.template ? JSON.parse(row.template) : {},
    used_count: row.usedCount ?? 0,
    win_rate: row.winRate ?? 0,
    review_status: (row.reviewStatus as ReviewStatus) ?? "draft",
    last_analyzed_at: row.lastAnalyzedAt ? row.lastAnalyzedAt.toISOString() : undefined,
  };
}

function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

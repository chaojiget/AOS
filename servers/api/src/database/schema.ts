import { sqliteTable, text, integer, index, real, uniqueIndex } from "drizzle-orm/sqlite-core";

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  task: text("task"),
  status: text("status").notNull(),
  input: text("input"),
  reason: text("reason"),
  finalResult: text("final_result_json"),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  stepCount: integer("step_count").default(0),
});

export const runEvents = sqliteTable(
  "run_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    ts: integer("ts", { mode: "timestamp_ms" }).notNull(),
    eventType: text("event_type").notNull(),
    topic: text("topic"),
    level: text("level"),
    payload: text("payload_json"),
    spanId: text("span_id"),
    parentSpanId: text("parent_span_id"),
    version: integer("version"),
    lineNumber: integer("ln"),
  },
  (table) => ({
    runIdx: index("run_events_run_idx").on(table.runId),
    tsIdx: index("run_events_ts_idx").on(table.runId, table.ts),
  }),
);

export const mcpConfigs = sqliteTable("mcp_configs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  transport: text("transport").notNull(),
  baseUrl: text("base_url"),
  auth: text("auth_json"),
  enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
  metadata: text("metadata_json"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const skills = sqliteTable("skills", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category"),
  tags: text("tags_json"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  template: text("template_json"),
  usedCount: integer("used_count").notNull().default(0),
  winRate: real("win_rate").notNull().default(0),
  reviewStatus: text("review_status").notNull().default("draft"),
  lastAnalyzedAt: integer("last_analyzed_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  version: integer("version").notNull().default(0),
  currentVersionId: text("current_version_id"),
});

export const skillVersions = sqliteTable(
  "skill_versions",
  {
    id: text("id").primaryKey(),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    category: text("category"),
    tags: text("tags_json"),
    template: text("template_json"),
    usedCount: integer("used_count").notNull().default(0),
    winRate: real("win_rate").notNull().default(0),
    reviewStatus: text("review_status").notNull().default("draft"),
    lastAnalyzedAt: integer("last_analyzed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    skillIdx: index("skill_versions_skill_idx").on(table.skillId),
    uniqueSkillVersion: uniqueIndex("skill_versions_unique").on(table.skillId, table.version),
  }),
);

export const skillRuns = sqliteTable(
  "skill_runs",
  {
    id: text("id").primaryKey(),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    runId: text("run_id").notNull(),
    totalCount: integer("total_count").notNull(),
    successCount: integer("success_count").notNull(),
    failureCount: integer("failure_count").notNull(),
    newEventCount: integer("new_event_count").notNull().default(0),
    newSuccessCount: integer("new_success_count").notNull().default(0),
    newFailureCount: integer("new_failure_count").notNull().default(0),
    lastEventAt: integer("last_event_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    skillIdx: index("skill_runs_skill_idx").on(table.skillId),
    runIdx: index("skill_runs_run_idx").on(table.runId),
  }),
);

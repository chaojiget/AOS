import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

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

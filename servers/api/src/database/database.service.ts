import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type Database from "better-sqlite3";
import { createRequire } from "module";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { ApiConfigService } from "../config/api-config.service";
import * as schema from "./schema";

type RunInsert = typeof schema.runs.$inferInsert;
type RunRow = typeof schema.runs.$inferSelect;
type RunUpdate = Partial<Omit<RunRow, "id">>;
type RunEventInsert = typeof schema.runEvents.$inferInsert;
type RunEventRow = typeof schema.runEvents.$inferSelect;
type McpInsert = typeof schema.mcpConfigs.$inferInsert;
type McpRow = typeof schema.mcpConfigs.$inferSelect;

type DatabaseMode = "sqlite" | "memory";

interface MemoryStore {
  runs: Map<string, RunRow>;
  runEvents: Map<string, RunEventRow[]>;
  mcpConfigs: Map<string, McpRow>;
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly mode: DatabaseMode;
  private readonly sqlite: Database.Database | null = null;
  readonly db: BetterSQLite3Database<typeof schema> | null = null;
  private readonly memory: MemoryStore | null = null;

  constructor(private readonly config: ApiConfigService) {
    const useMemory = process.env.AOS_USE_IN_MEMORY_DB === "1";

    if (!useMemory) {
      try {
        // eslint-disable-next-line global-require
        const require = createRequire(import.meta.url);
        const BetterSqlite = require("better-sqlite3") as typeof Database;
        const dbPath = this.config.databasePath;
        mkdirSync(dirname(dbPath), { recursive: true });
        const sqlite = new BetterSqlite(dbPath);
        sqlite.pragma("journal_mode = WAL");
        sqlite.pragma("foreign_keys = ON");
        this.sqlite = sqlite;
        this.db = drizzle(sqlite, { schema });
        this.mode = "sqlite";
        this.bootstrap();
        return;
      } catch (error) {
        // fall back to in-memory mode if native module fails to load
        // eslint-disable-next-line no-console
        console.warn("better-sqlite3 unavailable, falling back to in-memory database", error);
      }
    }

    this.mode = "memory";
    this.memory = {
      runs: new Map<string, RunRow>(),
      runEvents: new Map<string, RunEventRow[]>(),
      mcpConfigs: new Map<string, McpRow>(),
    };
  }

  private bootstrap(): void {
    if (!this.sqlite) {
      return;
    }
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        task TEXT,
        status TEXT NOT NULL,
        input TEXT,
        reason TEXT,
        final_result_json TEXT,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        step_count INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS run_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        topic TEXT,
        level TEXT,
        payload_json TEXT,
        span_id TEXT,
        parent_span_id TEXT,
        version INTEGER,
        ln INTEGER,
        FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS run_events_run_idx ON run_events(run_id);
      CREATE INDEX IF NOT EXISTS run_events_ts_idx ON run_events(run_id, ts);

      CREATE TABLE IF NOT EXISTS mcp_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        transport TEXT NOT NULL,
        base_url TEXT,
        auth_json TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  ping(): void {
    if (this.mode === "sqlite" && this.sqlite) {
      this.sqlite.prepare("select 1").get();
    }
  }

  onModuleDestroy(): void {
    if (this.sqlite) {
      this.sqlite.close();
    }
  }

  isMemoryMode(): boolean {
    return this.mode === "memory";
  }

  insertRun(record: RunInsert): void {
    if (!this.memory) return;
    if (this.memory.runs.has(record.id)) {
      return;
    }
    const row: RunRow = {
      id: record.id,
      task: record.task ?? null,
      status: record.status,
      input: record.input ?? null,
      reason: record.reason ?? null,
      finalResult: record.finalResult ?? null,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      stepCount: record.stepCount ?? 0,
    };
    this.memory.runs.set(row.id, row);
  }

  updateRun(id: string, patch: RunUpdate): void {
    if (!this.memory) return;
    const existing = this.memory.runs.get(id);
    if (!existing) {
      return;
    }
    this.memory.runs.set(id, {
      ...existing,
      ...patch,
    });
  }

  getRun(id: string): RunRow | undefined {
    if (!this.memory) return undefined;
    const match = this.memory.runs.get(id);
    return match ? { ...match } : undefined;
  }

  insertRunEvent(record: RunEventInsert): void {
    if (!this.memory) return;
    const rows = this.memory.runEvents.get(record.runId) ?? [];
    const row: RunEventRow = {
      id: record.id,
      runId: record.runId,
      ts: record.ts,
      eventType: record.eventType,
      topic: record.topic ?? null,
      level: record.level ?? null,
      payload: record.payload ?? null,
      spanId: record.spanId ?? null,
      parentSpanId: record.parentSpanId ?? null,
      version: record.version ?? null,
      lineNumber: record.lineNumber ?? null,
    };
    rows.push(row);
    rows.sort((a, b) => a.ts.getTime() - b.ts.getTime());
    this.memory.runEvents.set(record.runId, rows);
  }

  listRunEvents(runId: string, since?: number): RunEventRow[] {
    if (!this.memory) return [];
    const rows = this.memory.runEvents.get(runId) ?? [];
    if (since == null) {
      return rows.map((row) => ({ ...row, ts: new Date(row.ts) }));
    }
    const threshold = new Date(since);
    return rows
      .filter((row) => row.ts.getTime() > threshold.getTime())
      .map((row) => ({ ...row, ts: new Date(row.ts) }));
  }

  upsertMcpConfig(record: McpInsert): void {
    if (!this.memory) return;
    const existing = this.memory.mcpConfigs.get(record.id);
    const row: McpRow = {
      id: record.id,
      name: record.name,
      transport: record.transport,
      baseUrl: record.baseUrl ?? null,
      auth: record.auth ?? null,
      enabled: record.enabled ?? true,
      metadata: record.metadata ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
    if (existing) {
      this.memory.mcpConfigs.set(record.id, { ...existing, ...row, createdAt: existing.createdAt });
    } else {
      this.memory.mcpConfigs.set(record.id, row);
    }
  }

  getMcpConfig(id: string): McpRow | undefined {
    if (!this.memory) return undefined;
    const match = this.memory.mcpConfigs.get(id);
    return match ? { ...match } : undefined;
  }
}

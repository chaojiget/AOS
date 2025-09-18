import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { ApiConfigService } from "../config/api-config.service";
import * as schema from "./schema";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly sqlite: Database.Database;
  readonly db: BetterSQLite3Database<typeof schema>;

  constructor(private readonly config: ApiConfigService) {
    const dbPath = this.config.databasePath;
    mkdirSync(dirname(dbPath), { recursive: true });
    this.sqlite = new Database(dbPath);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("foreign_keys = ON");
    this.db = drizzle(this.sqlite, { schema });
    this.bootstrap();
  }

  private bootstrap(): void {
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
    this.sqlite.prepare("select 1").get();
  }

  onModuleDestroy(): void {
    this.sqlite.close();
  }
}

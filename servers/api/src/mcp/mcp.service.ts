import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import { mcpConfigs } from "../database/schema";

type McpConfigRow = typeof mcpConfigs.$inferSelect;

type Transport = "http" | "ws" | "stdio";

export interface RegisterMcpPayload {
  id?: string;
  name: string;
  transport: Transport;
  baseUrl?: string;
  auth?: Record<string, unknown> | null;
  enabled?: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface McpConfig {
  id: string;
  name: string;
  transport: Transport;
  baseUrl: string | null;
  enabled: boolean;
  auth: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class McpService {
  constructor(private readonly database: DatabaseService) {}

  async register(payload: RegisterMcpPayload): Promise<McpConfig | null> {
    const now = new Date();
    const id = payload.id?.trim() || randomUUID();
    const record = {
      id,
      name: payload.name,
      transport: payload.transport,
      baseUrl: payload.baseUrl ?? null,
      auth: payload.auth ? JSON.stringify(payload.auth) : null,
      enabled: payload.enabled ?? true,
      metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
      createdAt: now,
      updatedAt: now,
    } satisfies typeof mcpConfigs.$inferInsert;

    if (this.database.isMemoryMode()) {
      this.database.upsertMcpConfig(record);
    } else {
      await this.database
        .db!.insert(mcpConfigs)
        .values(record)
        .onConflictDoUpdate({
          target: mcpConfigs.id,
          set: {
            name: record.name,
            transport: record.transport,
            baseUrl: record.baseUrl,
            auth: record.auth,
            enabled: record.enabled,
            metadata: record.metadata,
            updatedAt: record.updatedAt,
          },
        })
        .run();
    }

    const stored = this.database.isMemoryMode()
      ? this.database.getMcpConfig(id)
      : this.database.db!.select().from(mcpConfigs).where(eq(mcpConfigs.id, id)).get();

    if (!stored) {
      return null;
    }

    return this.mapRow(stored);
  }

  async delete(id: string): Promise<McpConfig[]> {
    const trimmed = id.trim();

    if (this.database.isMemoryMode()) {
      if (trimmed) {
        this.database.deleteMcpConfig(trimmed);
      }
      const rows = this.database.listMcpConfigs();
      return this.mapRows(rows);
    }

    if (trimmed) {
      await this.database.db!.delete(mcpConfigs).where(eq(mcpConfigs.id, trimmed)).run();
    }

    const rows = this.database.db!.select().from(mcpConfigs).all();
    return this.mapRows(rows);
  }

  private parseJson(raw: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  private mapRow(row: McpConfigRow): McpConfig {
    return {
      id: row.id,
      name: row.name,
      transport: row.transport as Transport,
      baseUrl: row.baseUrl ?? null,
      enabled: !!row.enabled,
      auth: typeof row.auth === "string" ? this.parseJson(row.auth) : null,
      metadata: typeof row.metadata === "string" ? this.parseJson(row.metadata) : null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }

  private mapRows(rows: McpConfigRow[]): McpConfig[] {
    return rows
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((row) => this.mapRow(row));
  }
}

import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import { mcpConfigs } from "../database/schema";

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

@Injectable()
export class McpService {
  constructor(private readonly database: DatabaseService) {}

  async register(payload: RegisterMcpPayload) {
    const now = Date.now();
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

    await this.database.db
      .insert(mcpConfigs)
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

    const stored = this.database.db.select().from(mcpConfigs).where(eq(mcpConfigs.id, id)).get();

    if (!stored) {
      return null;
    }

    return {
      id: stored.id,
      name: stored.name,
      transport: stored.transport,
      baseUrl: stored.baseUrl,
      enabled: !!stored.enabled,
      auth: stored.auth ? this.parseJson(stored.auth) : null,
      metadata: stored.metadata ? this.parseJson(stored.metadata) : null,
      createdAt: new Date(stored.createdAt).toISOString(),
      updatedAt: new Date(stored.updatedAt).toISOString(),
    };
  }

  private parseJson(raw: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}

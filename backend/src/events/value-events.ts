import { PoolClient } from 'pg';
import { getPool } from '../db/postgres';

export interface ValueEventAction {
  label?: string;
  href?: string;
}

export interface ValueEventRecord {
  id: string;
  eventType: string;
  status: string;
  traceId?: string | null;
  title?: string | null;
  summary?: string | null;
  occurredAt: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  action: ValueEventAction;
}

export interface AppendValueEventInput {
  eventType: string;
  status?: string;
  traceId?: string | null;
  title?: string | null;
  summary?: string | null;
  actionLabel?: string | null;
  actionHref?: string | null;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
}

export const VALUE_EVENT_CHANNEL = 'aos_value_events';

let ensurePromise: Promise<void> | null = null;

type ValueEventRow = {
  id: string | number;
  eventType?: string | null;
  status?: string | null;
  traceId?: string | null;
  title?: string | null;
  summary?: string | null;
  occurredAt?: string | Date | null;
  payload?: unknown;
  metadata?: unknown;
  actionLabel?: string | null;
  actionHref?: string | null;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === 'object' && !Array.isArray(value);
};

const mapRowToRecord = (row: ValueEventRow): ValueEventRecord => {
  const occurredAt = typeof row.occurredAt === 'string'
    ? row.occurredAt
    : row.occurredAt instanceof Date
      ? row.occurredAt.toISOString()
      : new Date().toISOString();

  return {
    id: String(row.id),
    eventType: typeof row.eventType === 'string' && row.eventType.trim() ? row.eventType : 'event',
    status: typeof row.status === 'string' && row.status.trim() ? row.status : 'active',
    traceId: typeof row.traceId === 'string' && row.traceId.trim() ? row.traceId : null,
    title: typeof row.title === 'string' ? row.title : null,
    summary: typeof row.summary === 'string' ? row.summary : null,
    occurredAt,
    payload: isPlainRecord(row.payload) ? row.payload : {},
    metadata: isPlainRecord(row.metadata) ? row.metadata : {},
    action: {
      label: typeof row.actionLabel === 'string' ? row.actionLabel : undefined,
      href: typeof row.actionHref === 'string' ? row.actionHref : undefined,
    },
  } satisfies ValueEventRecord;
};

const ensureSchemaInternal = async (client: PoolClient) => {
  await client.query('BEGIN');
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS value_events (
        id BIGSERIAL PRIMARY KEY,
        event_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        trace_id TEXT,
        title TEXT,
        summary TEXT,
        action_label TEXT,
        action_href TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_value_events_occurred_at
        ON value_events (occurred_at DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_value_events_trace_id
        ON value_events (trace_id);
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION notify_value_events()
      RETURNS TRIGGER AS $$
      DECLARE
        payload JSONB;
      BEGIN
        payload := jsonb_build_object(
          'id', NEW.id::text,
          'eventType', NEW.event_type,
          'status', NEW.status,
          'traceId', NEW.trace_id,
          'title', NEW.title,
          'summary', NEW.summary,
          'occurredAt', NEW.occurred_at,
          'payload', NEW.payload,
          'metadata', COALESCE(NEW.metadata, '{}'::jsonb),
          'action', jsonb_build_object(
            'label', NEW.action_label,
            'href', NEW.action_href
          )
        );
        PERFORM pg_notify('${VALUE_EVENT_CHANNEL}', payload::text);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'value_events_notify_trigger'
        ) THEN
          CREATE TRIGGER value_events_notify_trigger
          AFTER INSERT ON value_events
          FOR EACH ROW
          EXECUTE FUNCTION notify_value_events();
        END IF;
      END;
      $$;
    `);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
};

export const ensureValueEventInfrastructure = async (): Promise<void> => {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const pool = getPool();
      const client = await pool.connect();
      try {
        await ensureSchemaInternal(client);
      } finally {
        client.release();
      }
    })();

    ensurePromise.catch(() => {
      ensurePromise = null;
    });
  }

  return ensurePromise;
};

export const listValueEvents = async (limit: number = 50): Promise<ValueEventRecord[]> => {
  await ensureValueEventInfrastructure();
  const pool = getPool();
  const capped = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 50;
  const { rows } = await pool.query<ValueEventRow>(
    `
      SELECT
        id::text AS id,
        event_type AS "eventType",
        status,
        trace_id AS "traceId",
        title,
        summary,
        action_label AS "actionLabel",
        action_href AS "actionHref",
        payload,
        metadata,
        occurred_at AS "occurredAt"
      FROM value_events
      ORDER BY occurred_at DESC
      LIMIT $1
    `,
    [capped],
  );
  return rows.map(mapRowToRecord);
};

export const appendValueEvent = async (input: AppendValueEventInput): Promise<ValueEventRecord> => {
  await ensureValueEventInfrastructure();
  const pool = getPool();
  const { rows } = await pool.query<ValueEventRow>(
    `
      INSERT INTO value_events (
        event_type,
        status,
        trace_id,
        title,
        summary,
        action_label,
        action_href,
        payload,
        metadata,
        occurred_at
      ) VALUES (
        $1,
        COALESCE(NULLIF($2, ''), 'active'),
        NULLIF($3, ''),
        NULLIF($4, ''),
        NULLIF($5, ''),
        NULLIF($6, ''),
        NULLIF($7, ''),
        $8::jsonb,
        $9::jsonb,
        COALESCE($10, NOW())
      )
      RETURNING
        id::text AS id,
        event_type AS "eventType",
        status,
        trace_id AS "traceId",
        title,
        summary,
        action_label AS "actionLabel",
        action_href AS "actionHref",
        payload,
        metadata,
        occurred_at AS "occurredAt"
    `,
    [
      input.eventType,
      input.status ?? null,
      input.traceId ?? null,
      input.title ?? null,
      input.summary ?? null,
      input.actionLabel ?? null,
      input.actionHref ?? null,
      JSON.stringify(input.payload ?? {}),
      JSON.stringify(input.metadata ?? {}),
      input.occurredAt ?? null,
    ],
  );

  return mapRowToRecord(rows[0]);
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  return isPlainRecord(value) ? value : null;
};

const asStringOrNull = (value: unknown): string | null => {
  return typeof value === 'string' ? value : null;
};

export const mapNotificationPayload = (payload: unknown): ValueEventRecord => {
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload) as unknown;
      return mapNotificationPayload(parsed);
    } catch {
      return mapRowToRecord({
        id: 'unknown',
        eventType: 'event',
        status: 'active',
        traceId: null,
        title: '解析通知失败',
        summary: payload,
        occurredAt: new Date().toISOString(),
        payload: {},
        metadata: {},
      });
    }
  }

  const record = asRecord(payload);
  if (!record) {
    return mapRowToRecord({
      id: 'unknown',
      eventType: 'event',
      status: 'active',
      traceId: null,
      title: '未知事件',
      summary: '无法解析价值事件通知。',
      occurredAt: new Date().toISOString(),
      payload: {},
      metadata: {},
    });
  }

  const actionRecord = asRecord(record.action);

  const candidate: ValueEventRow = {
    id: typeof record.id === 'number' || typeof record.id === 'string' ? record.id : 'unknown',
    eventType: asStringOrNull(record.eventType) ?? undefined,
    status: asStringOrNull(record.status) ?? undefined,
    traceId: asStringOrNull(record.traceId),
    title: asStringOrNull(record.title),
    summary: asStringOrNull(record.summary),
    occurredAt: asStringOrNull(record.occurredAt) ?? new Date().toISOString(),
    payload: record.payload,
    metadata: record.metadata,
    actionLabel: asStringOrNull(actionRecord?.label) ?? asStringOrNull(record.actionLabel) ?? undefined,
    actionHref: asStringOrNull(actionRecord?.href) ?? asStringOrNull(record.actionHref) ?? undefined,
  };

  return mapRowToRecord(candidate);
};

import { getPool } from '../db/postgres';

export interface EventPayload {
  traceId?: string | null;
  topic: string;
  type: string;
  severity?: 'info' | 'warn' | 'error';
  payload: Record<string, unknown>;
}

export const recordEvent = async (event: EventPayload) => {
  const pool = getPool();
  try {
    await pool.query(
      `INSERT INTO events (trace_id, topic, type, severity, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, now())`,
      [event.traceId ?? null, event.topic, event.type, event.severity ?? 'info', event.payload],
    );
  } catch (error) {
    console.error('[EVENTS] 写入失败', error);
  }
};

import { getPool } from '../db/postgres';
import { AuthContext } from '../auth/middleware';

export interface AuditEntry {
  actor: string;
  role: string;
  action: string;
  resource: string;
  diff?: Record<string, unknown> | null;
}

export const recordAudit = async (entry: AuditEntry) => {
  const pool = getPool();
  try {
    await pool.query(
      `INSERT INTO audit_logs (actor, action, resource, diff, created_at, role)
       VALUES ($1, $2, $3, $4, now(), $5)`,
      [entry.actor, entry.action, entry.resource, entry.diff ?? null, entry.role],
    );
  } catch (error) {
    console.error('[AUDIT] 写入失败', error);
  }
};

export const auditFromAuth = async (
  auth: AuthContext | undefined,
  action: string,
  resource: string,
  diff?: Record<string, unknown> | null,
) => {
  if (!auth) {
    console.warn('[AUDIT] 尝试记录但缺失 auth 上下文');
    return;
  }
  await recordAudit({
    actor: auth.subject,
    role: auth.role,
    action,
    resource,
    diff: diff ?? null,
  });
};

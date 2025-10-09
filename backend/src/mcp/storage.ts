import { Pool } from 'pg';
import { getPool } from '../db/postgres';
import {
  McpCapability,
  McpServerConfig,
  SandboxEnvironmentDefinition,
  SandboxScriptDefinition,
} from './types';

export interface McpPolicyRecord {
  name: string;
  quotaLimitPerMinute?: number | null;
  quotaBurstMultiplier?: number | null;
  circuitFailureThreshold?: number | null;
  circuitCooldownSeconds?: number | null;
  circuitMinimumSamples?: number | null;
}
import { Role, normalizeRole } from '../auth/roles';

let initialized = false;

const ensureTables = async (pool: Pool) => {
  if (initialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mcp_registry (
      name TEXT PRIMARY KEY,
      base_url TEXT NOT NULL,
      description TEXT,
      capabilities JSONB NOT NULL,
      auth_token TEXT,
      timeout_ms INTEGER,
      allowed_roles JSONB,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mcp_service_policies (
      name TEXT PRIMARY KEY REFERENCES mcp_registry(name) ON DELETE CASCADE,
      quota_limit_per_minute INTEGER,
      quota_burst_multiplier NUMERIC,
      circuit_failure_threshold INTEGER,
      circuit_cooldown_seconds INTEGER,
      circuit_minimum_samples INTEGER,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sandbox_environments (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      variables JSONB,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sandbox_scripts (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      entry_file TEXT NOT NULL,
      description TEXT,
      schedule_ms BIGINT,
      env JSONB,
      environment_id UUID REFERENCES sandbox_environments(id),
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      actor TEXT NOT NULL,
      role TEXT,
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      diff JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id BIGSERIAL PRIMARY KEY,
      trace_id TEXT,
      topic TEXT,
      type TEXT NOT NULL,
      severity TEXT,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      run_id UUID PRIMARY KEY,
      agent_id BIGINT,
      script_id UUID,
      trace_id TEXT,
      status TEXT,
      output TEXT,
      error TEXT,
      stats JSONB,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      duration_ms INTEGER,
      trigger TEXT,
      actor TEXT
    );
  `);

  await pool.query(`
    ALTER TABLE sandbox_scripts
      ADD COLUMN IF NOT EXISTS environment_id UUID REFERENCES sandbox_environments(id);
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS idx_agent_runs_script ON agent_runs(script_id, started_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_events_topic ON events(topic, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_sandbox_scripts_env ON sandbox_scripts(environment_id)');

  initialized = true;
};

export const ensureMcpStorage = async () => {
  const pool = getPool();
  await ensureTables(pool);
};

const parseJson = <T>(value: any, fallback: T): T => {
  if (value == null) return fallback;
  if (Array.isArray(value) || typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
};

const parseRolesList = (value: any): Role[] => {
  const raw = parseJson<any[]>(value, []);
  const roles: Role[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    try {
      roles.push(normalizeRole(item));
    } catch {
      // ignore invalid role
    }
  }
  return roles;
};

const allowedCapabilities = new Set<McpCapability>(['tools', 'files', 'secrets', 'events']);

const mapServerRow = (row: any): McpServerConfig => ({
  name: row.name,
  baseUrl: row.base_url,
  description: row.description ?? undefined,
  capabilities: parseJson<string[]>(row.capabilities, [])
    .filter((cap): cap is McpCapability => allowedCapabilities.has(cap as McpCapability)),
  authToken: row.auth_token ?? undefined,
  timeoutMs: row.timeout_ms ?? undefined,
  allowedRoles: parseRolesList(row.allowed_roles),
});

const mapEnvironmentRow = (row: any): SandboxEnvironmentDefinition => ({
  id: row.id,
  name: row.name,
  description: row.description ?? undefined,
  variables: parseJson<Record<string, string>>(row.variables, {}),
});

const mapScriptRow = (row: any): SandboxScriptDefinition => ({
  id: row.id,
  name: row.name,
  entryFile: row.entry_file,
  description: row.description ?? undefined,
  scheduleMs: row.schedule_ms ?? undefined,
  env: parseJson<Record<string, string> | undefined>(row.env, undefined),
  environmentId: row.environment_id ?? null,
});

export const loadRegistryFromStorage = async (): Promise<McpServerConfig[]> => {
  const pool = getPool();
  await ensureTables(pool);
  const result = await pool.query('SELECT * FROM mcp_registry ORDER BY name ASC');
  return result.rows.map(mapServerRow);
};

export const saveRegistryToStorage = async (config: McpServerConfig): Promise<void> => {
  const pool = getPool();
  await ensureTables(pool);
  await pool.query(
    `INSERT INTO mcp_registry (name, base_url, description, capabilities, auth_token, timeout_ms, allowed_roles, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (name) DO UPDATE SET
       base_url = EXCLUDED.base_url,
       description = EXCLUDED.description,
       capabilities = EXCLUDED.capabilities,
       auth_token = EXCLUDED.auth_token,
       timeout_ms = EXCLUDED.timeout_ms,
       allowed_roles = EXCLUDED.allowed_roles,
       updated_at = now()
    `,
    [
      config.name,
      config.baseUrl,
      config.description ?? null,
      config.capabilities ?? [],
      config.authToken ?? null,
      config.timeoutMs ?? null,
      (config.allowedRoles ?? []).map((role) => role),
    ],
  );
};

export const deleteRegistryFromStorage = async (name: string): Promise<void> => {
  const pool = getPool();
  await ensureTables(pool);
  await pool.query('DELETE FROM mcp_registry WHERE name = $1', [name]);
};

const mapPolicyRow = (row: any): McpPolicyRecord => ({
  name: row.name,
  quotaLimitPerMinute: row.quota_limit_per_minute ?? null,
  quotaBurstMultiplier: row.quota_burst_multiplier != null ? Number(row.quota_burst_multiplier) : null,
  circuitFailureThreshold: row.circuit_failure_threshold ?? null,
  circuitCooldownSeconds: row.circuit_cooldown_seconds ?? null,
  circuitMinimumSamples: row.circuit_minimum_samples ?? null,
});

export const loadPoliciesFromStorage = async (): Promise<McpPolicyRecord[]> => {
  const pool = getPool();
  await ensureTables(pool);
  const result = await pool.query('SELECT * FROM mcp_service_policies ORDER BY name ASC');
  return result.rows.map(mapPolicyRow);
};

export const savePolicyToStorage = async (policy: McpPolicyRecord): Promise<void> => {
  const pool = getPool();
  await ensureTables(pool);
  await pool.query(
    `INSERT INTO mcp_service_policies (
        name,
        quota_limit_per_minute,
        quota_burst_multiplier,
        circuit_failure_threshold,
        circuit_cooldown_seconds,
        circuit_minimum_samples,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (name) DO UPDATE SET
        quota_limit_per_minute = EXCLUDED.quota_limit_per_minute,
        quota_burst_multiplier = EXCLUDED.quota_burst_multiplier,
        circuit_failure_threshold = EXCLUDED.circuit_failure_threshold,
        circuit_cooldown_seconds = EXCLUDED.circuit_cooldown_seconds,
        circuit_minimum_samples = EXCLUDED.circuit_minimum_samples,
        updated_at = now()
    `,
    [
      policy.name,
      policy.quotaLimitPerMinute ?? null,
      policy.quotaBurstMultiplier ?? null,
      policy.circuitFailureThreshold ?? null,
      policy.circuitCooldownSeconds ?? null,
      policy.circuitMinimumSamples ?? null,
    ],
  );
};

export const loadSandboxEnvironments = async (): Promise<SandboxEnvironmentDefinition[]> => {
  const pool = getPool();
  await ensureTables(pool);
  const result = await pool.query('SELECT * FROM sandbox_environments ORDER BY name ASC');
  return result.rows.map(mapEnvironmentRow);
};

export const saveEnvironmentToStorage = async (environment: SandboxEnvironmentDefinition): Promise<void> => {
  const pool = getPool();
  await ensureTables(pool);
  await pool.query(
    `INSERT INTO sandbox_environments (id, name, description, variables, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       variables = EXCLUDED.variables,
       updated_at = now()
    `,
    [
      environment.id,
      environment.name,
      environment.description ?? null,
      environment.variables ?? {},
    ],
  );
};

export const deleteEnvironmentFromStorage = async (id: string): Promise<void> => {
  const pool = getPool();
  await ensureTables(pool);
  await pool.query('DELETE FROM sandbox_environments WHERE id = $1', [id]);
};

export const loadScriptsFromStorage = async (): Promise<SandboxScriptDefinition[]> => {
  const pool = getPool();
  await ensureTables(pool);
  const result = await pool.query('SELECT * FROM sandbox_scripts ORDER BY created_at ASC');
  return result.rows.map(mapScriptRow);
};

export const saveScriptToStorage = async (definition: SandboxScriptDefinition): Promise<void> => {
  const pool = getPool();
  await ensureTables(pool);
  await pool.query(
    `INSERT INTO sandbox_scripts (id, name, entry_file, description, schedule_ms, env, environment_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       entry_file = EXCLUDED.entry_file,
       description = EXCLUDED.description,
       schedule_ms = EXCLUDED.schedule_ms,
       env = EXCLUDED.env,
       environment_id = EXCLUDED.environment_id,
       updated_at = now()
    `,
    [
      definition.id,
      definition.name,
      definition.entryFile,
      definition.description ?? null,
      definition.scheduleMs ?? null,
      definition.env ?? null,
      definition.environmentId ?? null,
    ],
  );
};

export const deleteScriptFromStorage = async (id: string): Promise<void> => {
  const pool = getPool();
  await ensureTables(pool);
  await pool.query('DELETE FROM sandbox_scripts WHERE id = $1', [id]);
};
export interface AgentRunRecord {
  runId: string;
  scriptId: string;
  status: 'success' | 'error';
  output: string;
  error?: string | null;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  trigger: 'manual' | 'schedule';
  actor?: string | null;
  traceId?: string | null;
}

export const insertAgentRunRecord = async (record: AgentRunRecord): Promise<void> => {
  const pool = getPool();
  await ensureTables(pool);
  await pool.query(
    `INSERT INTO agent_runs (run_id, script_id, status, output, error, started_at, finished_at, duration_ms, trigger, actor, trace_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (run_id) DO NOTHING`,
    [
      record.runId,
      record.scriptId,
      record.status,
      record.output,
      record.error ?? null,
      record.startedAt,
      record.finishedAt,
      record.durationMs,
      record.trigger,
      record.actor ?? null,
      record.traceId ?? null,
    ],
  );
};

export interface AgentRunRow {
  runId: string;
  scriptId: string;
  status: 'success' | 'error';
  output: string;
  error?: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  trigger: 'manual' | 'schedule';
  actor?: string | null;
  traceId?: string | null;
}

export const loadAgentRunsForScript = async (scriptId: string, limit = 20): Promise<AgentRunRow[]> => {
  const pool = getPool();
  await ensureTables(pool);
  const result = await pool.query(
    `SELECT run_id, script_id, status, output, error, started_at, finished_at, duration_ms, trigger, actor, trace_id
     FROM agent_runs
     WHERE script_id = $1
     ORDER BY started_at DESC NULLS LAST
     LIMIT $2`,
    [scriptId, limit],
  );
  return result.rows.map((row) => ({
    runId: row.run_id,
    scriptId: row.script_id,
    status: row.status,
    output: row.output ?? '',
    error: row.error ?? undefined,
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : '',
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : '',
    durationMs: typeof row.duration_ms === 'number' ? row.duration_ms : 0,
    trigger: (row.trigger === 'schedule' ? 'schedule' : 'manual') as 'manual' | 'schedule',
    actor: row.actor ?? undefined,
    traceId: row.trace_id ?? undefined,
  }));
};

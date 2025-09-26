import { Role } from '../auth/roles';

export type McpCapability = 'tools' | 'files' | 'secrets' | 'events';

export interface McpServerConfig {
  name: string;
  baseUrl: string;
  description?: string;
  capabilities: McpCapability[];
  authToken?: string;
  timeoutMs?: number;
  allowedRoles?: Role[];
}

export interface McpCallRequest {
  server: string;
  tool: string;
  args?: Record<string, any>;
  capability?: McpCapability;
}

export interface McpCallResult {
  server: string;
  tool: string;
  durationMs: number;
  result: unknown;
}

export interface SandboxScriptDefinition {
  id: string;
  name: string;
  description?: string;
  entryFile: string;
  scheduleMs?: number;
  env?: Record<string, string>;
}

export type SandboxRunTrigger = 'manual' | 'schedule';

export interface SandboxRunResult {
  runId: string;
  scriptId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  output: string;
  status: 'success' | 'error';
  trigger: SandboxRunTrigger;
  error?: string;
  actor?: string;
}

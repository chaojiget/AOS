import { randomUUID } from 'crypto';
import { insertAgentRunRecord } from './storage';
import { recordEvent } from '../events/logger';
import { SandboxRunTrigger } from './types';

export interface SandboxRunLogInput {
  runId?: string;
  scriptId: string;
  scriptName: string;
  output: string;
  error?: string;
  startedAt: Date;
  finishedAt: Date;
  trigger: SandboxRunTrigger;
  actor?: string;
}

export const logSandboxRun = async (input: SandboxRunLogInput) => {
  const runId = input.runId ?? randomUUID();
  const status = input.error ? 'error' : 'success';
  const durationMs = input.finishedAt.getTime() - input.startedAt.getTime();

  await insertAgentRunRecord({
    runId,
    scriptId: input.scriptId,
    status,
    output: input.output,
    error: input.error,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs,
    trigger: input.trigger,
    actor: input.actor ?? null,
    traceId: runId,
  });

  await recordEvent({
    traceId: runId,
    topic: 'sandbox.script',
    type: status === 'success' ? 'sandbox.run.success' : 'sandbox.run.error',
    severity: status === 'success' ? 'info' : 'error',
    payload: {
      scriptId: input.scriptId,
      scriptName: input.scriptName,
      durationMs,
      trigger: input.trigger,
      actor: input.actor,
      outputPreview: input.output?.slice(0, 500),
      error: input.error,
      finishedAt: input.finishedAt.toISOString(),
    },
  });

  return runId;
};

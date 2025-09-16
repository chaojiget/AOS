import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { EventEnvelope } from './events';

export interface ReplayOptions {
  dir?: string;
  onEvent?: (event: EventEnvelope) => void | Promise<void>;
}

export async function replayEpisode(
  traceId: string,
  options: ReplayOptions = {}
): Promise<EventEnvelope[]> {
  const baseDir = options.dir ?? join(process.cwd(), 'episodes');
  const filePath = join(baseDir, `${traceId}.jsonl`);
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (err: any) {
    if (err && err.code === 'ENOENT') {
      throw new Error(`episode not found for trace ${traceId}`);
    }
    throw err;
  }

  const lines = content.split('\n').filter(Boolean);
  const events: EventEnvelope[] = [];
  for (const line of lines) {
    const parsed = JSON.parse(line) as EventEnvelope;
    events.push(parsed);
    if (options.onEvent) {
      await options.onEvent(parsed);
    }
  }
  return events;
}

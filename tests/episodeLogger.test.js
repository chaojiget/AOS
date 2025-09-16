import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { EpisodeLogger } from '../runtime/episode.js';

describe('EpisodeLogger', () => {
  it('writes JSONL entries with monotonic line numbers and offsets', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'episode-'));
    let tick = 0;
    const logger = new EpisodeLogger({
      traceId: 'trace-123',
      baseDir,
      clock: () => new Date(Date.UTC(2024, 0, 1, 0, 0, tick++)),
    });

    const first = await logger.log({ type: 'progress', step: 'plan', note: 'start' });
    const second = await logger.log({ type: 'final', outputs: { text: 'done' } });

    expect(first.ln).toBe(1);
    expect(first.byte_offset).toBe(0);
    expect(second.ln).toBe(2);
    const firstBytes = Buffer.byteLength(`${JSON.stringify(first)}\n`);
    expect(second.byte_offset).toBe(firstBytes);

    const filePath = join(baseDir, 'trace-123', 'v001', 'events.jsonl');
    const fileContents = await readFile(filePath, 'utf8');
    const lines = fileContents.trim().split('\n');
    expect(lines).toHaveLength(2);
    const parsedSecond = JSON.parse(lines[1]);
    expect(parsedSecond.byte_offset).toBe(firstBytes);
    expect(parsedSecond.ln).toBe(2);

    const manifestPath = join(baseDir, 'trace-123', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    expect(manifest.latest_version).toBe('v001');
    expect(manifest.versions['v001'].latest_ln).toBe(2);
    expect(manifest.versions['v001'].latest_ts).toBe(second.ts);
  });
});

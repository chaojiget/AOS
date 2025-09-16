import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { EpisodeLogger } from '../runtime/episode.js';
import { replay, Replay } from '../runtime/replay.js';

describe('Replay', () => {
  it('streams events in the order they were recorded', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'replay-'));
    let tick = 0;
    const logger = new EpisodeLogger({
      traceId: 'trace-replay',
      baseDir,
      clock: () => new Date(Date.UTC(2024, 0, 1, 0, 0, tick++)),
    });

    const first = await logger.log({ type: 'progress', step: 'act' });
    const second = await logger.log({ type: 'final', outputs: { answer: 42 } });

    const seenTypes = [];
    const events = await replay({ traceId: 'trace-replay', baseDir, onEvent: (event) => seenTypes.push(event.type) });

    expect(events).toHaveLength(2);
    expect(events[0].ln).toBe(first.ln);
    expect(events[1].ln).toBe(second.ln);
    expect(seenTypes).toEqual(['progress', 'final']);
  });

  it('supports the Replay class helper', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'replay-class-'));
    const logger = new EpisodeLogger({ traceId: 'trace-class', baseDir });
    await logger.log({ type: 'progress', step: 'plan' });
    await logger.log({ type: 'final', outputs: { ok: true } });

    const runner = new Replay({ traceId: 'trace-class', baseDir });
    const events = await runner.run();
    expect(events.map((event) => event.type)).toEqual(['progress', 'final']);
  });
});

import { describe, it, expect } from 'vitest';
import { runLoop } from '../core/agent.js';

describe('runLoop', () => {
  it('executes plan steps and resolves when review passes', async () => {
    const emitted = [];
    const kernel = {
      async perceive() {
        emitted.push({ type: 'perceived' });
      },
      async plan() {
        return {
          steps: [
            { id: 's1', op: 'tool.echo', args: { value: 'hi' } },
            { id: 's2', op: 'tool.echo', args: { value: 'there' } },
          ],
        };
      },
      async act(step) {
        return { id: step.id, result: step.args.value.toUpperCase() };
      },
      async review(outputs) {
        return { score: outputs.length, passed: true, notes: ['ok'] };
      },
      async renderFinal(outputs) {
        return outputs.map((item) => item.result).join(' ');
      },
    };

    const result = await runLoop(kernel, (event) => emitted.push(event), { maxIterations: 3 });

    expect(result.status).toBe('final');
    expect(result.outputs).toBe('HI THERE');
    expect(emitted.some((event) => event.type === 'plan.ready')).toBeTruthy();
    expect(emitted.filter((event) => event.type === 'tool')).toHaveLength(2);
    const finalEvent = emitted.find((event) => event.type === 'final');
    expect(finalEvent.outputs).toBe('HI THERE');
  });

  it('falls back to final output when no plan is produced', async () => {
    const emitted = [];
    const kernel = {
      async plan() {
        return { steps: [] };
      },
      async act(step) {
        return { fallback: true, reason: step.args.reason };
      },
      async renderFinal(outputs) {
        return outputs;
      },
    };

    const result = await runLoop(kernel, (event) => emitted.push(event));

    expect(result.status).toBe('final');
    expect(result.reason).toBe('no-plan');
    expect(result.outputs).toEqual([{ fallback: true, reason: 'no-plan' }]);
    const finalEvent = emitted.find((event) => event.type === 'final');
    expect(finalEvent.reason).toBe('no-plan');
    expect(emitted.some((event) => event.type === 'tool' && event.name === 'respond')).toBeTruthy();
  });
});

import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../src/lib/concurrency';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('mapWithConcurrency', () => {
  it('returns results in input order regardless of completion order', async () => {
    const result = await mapWithConcurrency([30, 10, 20], 3, async (value) => {
      await new Promise((resolve) => setTimeout(resolve, value / 10));
      return value * 2;
    });

    expect(result).toEqual([60, 20, 40]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency(
      Array.from({ length: 12 }, (_u, i) => i),
      3,
      async (value) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return value;
      },
    );

    expect(peak).toBeLessThanOrEqual(3);
  });

  it('starts a queued item only when a slot frees up', async () => {
    const gate = deferred();
    const started: number[] = [];

    const run = mapWithConcurrency([0, 1, 2], 2, async (value) => {
      started.push(value);
      await gate.promise;
      return value;
    });

    await Promise.resolve();
    expect(started).toEqual([0, 1]);

    gate.resolve();
    await run;
    expect(started).toEqual([0, 1, 2]);
  });

  it('handles an empty input without spawning workers', async () => {
    await expect(mapWithConcurrency([], 4, async () => 1)).resolves.toEqual([]);
  });
});

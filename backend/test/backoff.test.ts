import { describe, expect, it, vi } from 'vitest';
import { withRetry } from '../src/lib/backoff';

/**
 * The retry loop is the only place in the service that sleeps, so the clock is
 * injected. No test here waits on a real timer.
 */
const recordingSleep = () => {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
};

const retryable = (value: boolean) =>
  Object.assign(new Error(value ? 'transient' : 'fatal'), { retryable: value });

const options = (sleep: (ms: number) => Promise<void>, overrides = {}) => ({
  attempts: 4,
  baseMs: 100,
  isRetryable: (error: unknown) => Boolean((error as { retryable?: boolean }).retryable),
  sleep,
  ...overrides,
});

describe('withRetry', () => {
  it('returns the first successful result without sleeping', async () => {
    const { delays, sleep } = recordingSleep();
    const task = vi.fn(async () => 'ok');

    await expect(withRetry(task, options(sleep))).resolves.toBe('ok');

    expect(task).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it('retries a retryable failure until it succeeds', async () => {
    const { delays, sleep } = recordingSleep();
    const task = vi
      .fn()
      .mockRejectedValueOnce(retryable(true))
      .mockRejectedValueOnce(retryable(true))
      .mockResolvedValue('ok');

    await expect(withRetry(task, options(sleep))).resolves.toBe('ok');

    expect(task).toHaveBeenCalledTimes(3);
    expect(delays).toHaveLength(2);
  });

  it('gives up immediately on a non-retryable failure', async () => {
    const { delays, sleep } = recordingSleep();
    const task = vi.fn().mockRejectedValue(retryable(false));

    await expect(withRetry(task, options(sleep))).rejects.toThrow('fatal');

    expect(task).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it('stops after the configured number of attempts', async () => {
    const { delays, sleep } = recordingSleep();
    const task = vi.fn().mockRejectedValue(retryable(true));

    await expect(withRetry(task, options(sleep, { attempts: 3 }))).rejects.toThrow('transient');

    expect(task).toHaveBeenCalledTimes(3);
    // Three attempts means two waits: the last failure is not slept on.
    expect(delays).toHaveLength(2);
  });

  it('grows the delay exponentially between attempts', async () => {
    const { delays, sleep } = recordingSleep();
    const task = vi.fn().mockRejectedValue(retryable(true));
    // Remove jitter so the growth is assertable.
    vi.spyOn(Math, 'random').mockReturnValue(0);

    await expect(withRetry(task, options(sleep, { attempts: 4 }))).rejects.toThrow();

    expect(delays).toEqual([100, 200, 400]);
    vi.restoreAllMocks();
  });

  it('prefers a server-supplied Retry-After over its own backoff', async () => {
    const { delays, sleep } = recordingSleep();
    const task = vi.fn().mockRejectedValueOnce(retryable(true)).mockResolvedValue('ok');

    await withRetry(task, options(sleep, { retryAfterMs: () => 7_000 }));

    expect(delays).toEqual([7_000]);
  });

  it('never waits longer than the cap, however large Retry-After is', async () => {
    const { delays, sleep } = recordingSleep();
    const task = vi.fn().mockRejectedValueOnce(retryable(true)).mockResolvedValue('ok');

    await withRetry(task, options(sleep, { retryAfterMs: () => 3_600_000, maxDelayMs: 30_000 }));

    expect(delays).toEqual([30_000]);
  });
});

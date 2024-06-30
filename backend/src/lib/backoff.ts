import logger from './logger';

export interface RetryOptions {
  /** Total attempts, including the first. */
  attempts: number;
  /** Base delay; attempt N waits roughly `baseMs * 2^(N-1)` plus jitter. */
  baseMs: number;
  /** Upper bound on a single wait, so a huge `Retry-After` cannot stall a worker forever. */
  maxDelayMs?: number;
  /** Decides whether a failure is worth another attempt. */
  isRetryable: (error: unknown) => boolean;
  /** Lets the caller honour a server-supplied `Retry-After`. */
  retryAfterMs?: (error: unknown) => number | null;
  /** Label used in the retry log line. */
  label?: string;
  /** Injected in tests so the suite never actually sleeps. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Full jitter: spreads a retrying fleet out instead of synchronising it. */
export const jitter = (delayMs: number): number => Math.round(Math.random() * delayMs);

/**
 * Runs `task`, retrying retryable failures with exponential backoff and full
 * jitter. GitHub asks clients to back off on secondary rate limits rather than
 * hammering, and honouring `Retry-After` is the difference between a slow sync
 * and a suspended OAuth app.
 */
export const withRetry = async <T>(task: () => Promise<T>, options: RetryOptions): Promise<T> => {
  const sleep = options.sleep ?? defaultSleep;
  const maxDelayMs = options.maxDelayMs ?? 60_000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;

      if (attempt === options.attempts || !options.isRetryable(error)) {
        throw error;
      }

      const serverDelay = options.retryAfterMs?.(error) ?? null;
      const backoff = options.baseMs * 2 ** (attempt - 1);
      const delay = Math.min(serverDelay ?? backoff + jitter(options.baseMs), maxDelayMs);

      logger.warn('retrying upstream call', {
        label: options.label ?? 'upstream',
        attempt,
        of: options.attempts,
        delayMs: delay,
      });

      await sleep(delay);
    }
  }

  throw lastError;
};

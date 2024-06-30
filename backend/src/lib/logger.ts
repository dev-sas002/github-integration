import appConfig from '../config/appConfig';

const LEVELS = ['error', 'warn', 'info', 'debug'] as const;

export type LogLevel = (typeof LEVELS)[number];

const threshold = LEVELS.indexOf((appConfig.logLevel as LogLevel) ?? 'info');
const activeThreshold = threshold === -1 ? LEVELS.indexOf('info') : threshold;

/** Keys whose values must never reach a log line. */
const REDACTED_KEYS = /token|secret|password|authorization|api[-_]?key/i;

const redact = (context: Record<string, unknown>): Record<string, unknown> => {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    safe[key] = REDACTED_KEYS.test(key) ? '[redacted]' : value;
  }
  return safe;
};

const emit = (level: LogLevel, message: string, context: Record<string, unknown> = {}): void => {
  if (LEVELS.indexOf(level) > activeThreshold) {
    return;
  }

  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    message,
    ...redact(context),
  });

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    // This module is the single stdout sink for the service; the no-console
    // rule exists to stop *other* files writing here directly.
    // eslint-disable-next-line no-console
    console.log(line);
  }
};

/**
 * Minimal structured logger. Everything the service emits is a single JSON
 * line, which is what log shippers want, and credentials are redacted by key
 * name so an accidental `{ accessToken }` never lands in stdout.
 */
export const logger = {
  error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
  info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
  debug: (message: string, context?: Record<string, unknown>) => emit('debug', message, context),
};

export default logger;

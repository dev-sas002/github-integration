import crypto from 'crypto';

/**
 * Short-lived store for OAuth `state` values.
 *
 * GitHub echoes the `state` parameter back on the callback. Issuing an
 * unguessable value here and requiring it on the way back is what stops an
 * attacker from replaying their own `code` against a victim's session
 * (OAuth CSRF / "login CSRF").
 *
 * The store is intentionally in-memory: the states live for minutes and are
 * single-use. A multi-instance deployment needs a shared store (Redis, or a
 * signed cookie) instead.
 */
const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_STATES = 1000;

const pendingStates = new Map<string, number>();

const purgeExpired = (now: number): void => {
  for (const [state, expiresAt] of pendingStates) {
    if (expiresAt <= now) {
      pendingStates.delete(state);
    }
  }
};

/** Creates, stores and returns a new single-use `state` value. */
export const createOAuthState = (): string => {
  const now = Date.now();
  purgeExpired(now);

  // Hard cap so a flood of /connect calls cannot grow the map without bound.
  while (pendingStates.size >= MAX_PENDING_STATES) {
    const oldest = pendingStates.keys().next();
    if (oldest.done) {
      break;
    }
    pendingStates.delete(oldest.value);
  }

  const state = crypto.randomBytes(32).toString('hex');
  pendingStates.set(state, now + STATE_TTL_MS);
  return state;
};

/**
 * Validates a `state` returned by GitHub and consumes it so it cannot be
 * replayed. Returns `false` for unknown, expired or already-used values.
 */
export const consumeOAuthState = (state: unknown): boolean => {
  if (typeof state !== 'string' || state.length === 0) {
    return false;
  }

  const now = Date.now();
  purgeExpired(now);

  const expiresAt = pendingStates.get(state);
  if (expiresAt === undefined) {
    return false;
  }

  pendingStates.delete(state);
  return expiresAt > now;
};

/** Test helper: drops every pending state. */
export const resetOAuthStates = (): void => {
  pendingStates.clear();
};

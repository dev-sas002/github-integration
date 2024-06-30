import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createOAuthState, consumeOAuthState, resetOAuthStates } from '../src/helpers/oauthState';

describe('oauthState', () => {
  beforeEach(() => {
    resetOAuthStates();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('issues unguessable, unique states', () => {
    const first = createOAuthState();
    const second = createOAuthState();

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toEqual(second);
  });

  it('accepts a state it issued', () => {
    expect(consumeOAuthState(createOAuthState())).toBe(true);
  });

  it('rejects a replayed state (single use)', () => {
    const state = createOAuthState();

    expect(consumeOAuthState(state)).toBe(true);
    expect(consumeOAuthState(state)).toBe(false);
  });

  it('rejects a state it never issued', () => {
    createOAuthState();
    expect(consumeOAuthState('f'.repeat(64))).toBe(false);
  });

  it.each([[undefined], [null], [''], [42], [{}], [['a']]])(
    'rejects non-string state %p',
    (value) => {
      expect(consumeOAuthState(value)).toBe(false);
    },
  );

  it('rejects a state older than the TTL', () => {
    vi.useFakeTimers();
    const state = createOAuthState();

    vi.advanceTimersByTime(10 * 60 * 1000 + 1);

    expect(consumeOAuthState(state)).toBe(false);
  });

  it('still accepts a state just inside the TTL', () => {
    vi.useFakeTimers();
    const state = createOAuthState();

    vi.advanceTimersByTime(10 * 60 * 1000 - 1000);

    expect(consumeOAuthState(state)).toBe(true);
  });
});

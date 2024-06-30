import { describe, expect, it } from 'vitest';
import SyncStateModel from '../../src/models/syncState';

/**
 * Schema-level checks. `validateSync()` runs mongoose's validators without a
 * connection, so these are fast and need no database.
 */
describe('SyncState schema', () => {
  const base = {
    userId: '68d1a2b3c4d5e6f708192a3b',
    provider: 'github',
    resource: 'repositories',
  };

  it('accepts the empty scope the account-wide resources use', () => {
    // Regression: `required: true` on `scopeId` rejects '', which made every
    // repository-listing sync fail validation before it could persist.
    const state = new SyncStateModel({ ...base, scopeId: '' });

    expect(state.validateSync()).toBeUndefined();
  });

  it('defaults the scope to the empty string', () => {
    const state = new SyncStateModel(base);

    expect(state.scopeId).toBe('');
    expect(state.validateSync()).toBeUndefined();
  });

  it('accepts a repository id as the scope', () => {
    const state = new SyncStateModel({ ...base, resource: 'commits', scopeId: '100001' });

    expect(state.validateSync()).toBeUndefined();
  });

  it('rejects a status outside the known set', () => {
    const state = new SyncStateModel({ ...base, lastStatus: 'weird' });

    expect(state.validateSync()?.errors['lastStatus']).toBeDefined();
  });

  it('still requires the resource name', () => {
    const state = new SyncStateModel({ userId: base.userId, provider: 'github' });

    expect(state.validateSync()?.errors['resource']).toBeDefined();
  });
});

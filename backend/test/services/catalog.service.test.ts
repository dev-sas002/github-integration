import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Read-side tests. The query builder is stubbed so each case can assert the
 * filter, projection, sort and limit that reach mongoose — which is where the
 * scalability properties of these endpoints actually live.
 */
const mocks = vi.hoisted(() => {
  const captured: any[] = [];

  const queryBuilder = (rows: any[]) => {
    const state: any = {};
    const builder: any = {
      select: (projection: any) => {
        state.projection = projection;
        return builder;
      },
      sort: (sort: any) => {
        state.sort = sort;
        return builder;
      },
      skip: (skip: number) => {
        state.skip = skip;
        return builder;
      },
      limit: (limit: number) => {
        state.limit = limit;
        return builder;
      },
      lean: async () => {
        captured.push(state);
        return rows;
      },
    };
    return { builder, state };
  };

  const model = (rows: any[] = [], total = 0) => ({
    rows,
    find: vi.fn((filter: any) => {
      const { builder, state } = queryBuilder(rows);
      state.filter = filter;
      return builder;
    }),
    countDocuments: vi.fn(async () => total),
    aggregate: vi.fn(async () => []),
    distinct: vi.fn(async () => [] as unknown[]),
    findOne: vi.fn(() => ({
      sort: () => ({ select: () => ({ lean: async () => null }) }),
      select: () => ({ lean: async () => null }),
    })),
    collection: { name: 'things' },
  });

  return {
    captured,
    RepositoryModel: model([{ fullName: 'octo-labs/a' }], 42),
    CommitModel: model([], 0),
    IssueModel: model([], 0),
    PullRequestModel: model([], 0),
    SyncStateModel: model([], 0),
  };
});

vi.mock('../../src/models/repository', () => ({ default: mocks.RepositoryModel }));
vi.mock('../../src/models/commit', () => ({ default: mocks.CommitModel }));
vi.mock('../../src/models/issue', () => ({ default: mocks.IssueModel }));
vi.mock('../../src/models/pullRequest', () => ({ default: mocks.PullRequestModel }));
vi.mock('../../src/models/syncState', () => ({ default: mocks.SyncStateModel }));

import {
  listCommits,
  listIssues,
  listPullRequests,
  listRepositories,
  listRepositoryLanguages,
  resolvePaging,
} from '../../src/services/catalog.service';

const lastQuery = () => mocks.captured[mocks.captured.length - 1];

beforeEach(() => {
  mocks.captured.length = 0;
});

describe('resolvePaging', () => {
  it('defaults to page 1 and the configured page size', () => {
    expect(resolvePaging({})).toEqual({ page: 1, limit: 25, skip: 0 });
  });

  it('computes the skip from the page', () => {
    expect(resolvePaging({ page: 4, limit: 10 })).toEqual({ page: 4, limit: 10, skip: 30 });
  });

  it('clamps an unbounded limit to the server maximum', () => {
    expect(resolvePaging({ limit: 100000 }).limit).toBe(100);
  });

  it('rejects a zero or negative limit', () => {
    expect(resolvePaging({ limit: 0 }).limit).toBe(25);
    expect(resolvePaging({ limit: -5 }).limit).toBe(1);
  });

  it('never produces a negative skip from a nonsense page', () => {
    expect(resolvePaging({ page: -3 }).skip).toBe(0);
    expect(resolvePaging({ page: 0 }).skip).toBe(0);
  });

  it('ignores non-numeric input rather than producing NaN', () => {
    expect(resolvePaging({ page: 'abc' as never, limit: 'xyz' as never })).toEqual({
      page: 1,
      limit: 25,
      skip: 0,
    });
  });
});

describe('listRepositories', () => {
  it('scopes every query to the calling user', async () => {
    await listRepositories('u1', {});

    expect(lastQuery().filter).toMatchObject({ userId: 'u1' });
  });

  it('returns paging metadata alongside the rows', async () => {
    const page = await listRepositories('u1', { page: 2, limit: 10 });

    expect(page).toMatchObject({ page: 2, limit: 10, total: 42, totalPages: 5, hasNext: true });
  });

  it('never selects the raw userId or version key', async () => {
    await listRepositories('u1', {});

    expect(lastQuery().projection).toEqual({ __v: 0, userId: 0 });
  });

  it('sorts by last push by default, which the compound index covers', async () => {
    await listRepositories('u1', {});

    expect(lastQuery().sort).toEqual({ pushedAt: -1 });
  });

  it('supports the other documented sorts', async () => {
    await listRepositories('u1', { sort: 'stars' });
    expect(lastQuery().sort).toEqual({ stars: -1 });

    await listRepositories('u1', { sort: 'name' });
    expect(lastQuery().sort).toEqual({ fullName: 1 });
  });

  it('falls back to the default sort for an unknown value', async () => {
    await listRepositories('u1', { sort: 'nonsense' as never });

    expect(lastQuery().sort).toEqual({ pushedAt: -1 });
  });

  it('filters by language when asked', async () => {
    await listRepositories('u1', { language: 'Go' });

    expect(lastQuery().filter.language).toBe('Go');
  });

  it('escapes regex metacharacters in the search term', async () => {
    await listRepositories('u1', { q: 'a.b*c' });

    expect(lastQuery().filter.fullName.$regex).toBe('a\\.b\\*c');
    expect(lastQuery().filter.fullName.$options).toBe('i');
  });
});

describe('listCommits / listIssues / listPullRequests', () => {
  it('sorts commits newest first', async () => {
    await listCommits('u1', {});

    expect(lastQuery().sort).toEqual({ committedAt: -1 });
  });

  it('filters commits by repository and author', async () => {
    await listCommits('u1', { repositoryId: '100000', author: 'ylin' });

    expect(lastQuery().filter).toMatchObject({
      repositoryExternalId: '100000',
      authorLogin: 'ylin',
    });
  });

  it('filters issues by state', async () => {
    await listIssues('u1', { state: 'closed' });

    expect(lastQuery().filter.state).toBe('closed');
  });

  it('filters pull requests by state and sorts by last update', async () => {
    await listPullRequests('u1', { state: 'merged' });

    expect(lastQuery().filter.state).toBe('merged');
    expect(lastQuery().sort).toEqual({ remoteUpdatedAt: -1 });
  });

  it('applies the clamped limit to the database query, not after the fact', async () => {
    await listIssues('u1', { limit: 9999 });

    expect(lastQuery().limit).toBe(100);
  });
});

describe('listRepositoryLanguages', () => {
  it('lists every language on the account, sorted, without blanks', async () => {
    mocks.RepositoryModel.distinct.mockResolvedValueOnce(['Rust', 'Go', '', 'CSS']);

    const languages = await listRepositoryLanguages('user-1');

    expect(languages).toEqual(['CSS', 'Go', 'Rust']);
    expect(mocks.RepositoryModel.distinct).toHaveBeenCalledWith('language', {
      userId: 'user-1',
      language: { $ne: null },
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError, SourceProvider } from '../../src/domain/provider';
import { PageRequest, ProviderPage, RepositoryScope } from '../../src/domain/types';

/**
 * Pipeline tests.
 *
 * The provider is a hand-written fake and both persistence and sync-state are
 * module mocks, so these cases exercise the orchestration — pagination,
 * watermarks, conditional requests, quota guarding, failure isolation — with
 * no HTTP client and no database anywhere in the picture.
 */
const mocks = vi.hoisted(() => {
  const states = new Map<string, { etag: string | null; lastSyncedAt: Date | null }>();
  const savedStates: any[] = [];

  const SyncStateModel = {
    findOne: vi.fn((filter: any) => ({
      lean: async () => states.get(`${filter.resource}:${filter.scopeId}`) ?? null,
    })),
    findOneAndUpdate: vi.fn(async (filter: any, update: any) => {
      savedStates.push({ filter, update: update.$set });
      return {};
    }),
  };

  const persistence = {
    persistRepositories: vi.fn(async (_u: any, _p: any, items: any[]) => ({
      matched: 0,
      upserted: items.length,
    })),
    persistCommits: vi.fn(async (_u: any, _p: any, items: any[]) => ({
      matched: 0,
      upserted: items.length,
    })),
    persistIssues: vi.fn(async (_u: any, _p: any, items: any[]) => ({
      matched: 0,
      upserted: items.length,
    })),
    persistPullRequests: vi.fn(async (_u: any, _p: any, items: any[]) => ({
      matched: 0,
      upserted: items.length,
    })),
    purgeSyncedData: vi.fn(async () => undefined),
  };

  const RepositoryModel = {
    find: vi.fn(() => ({
      select: () => ({ sort: () => ({ lean: async () => [] }) }),
    })),
  };

  return { SyncStateModel, persistence, RepositoryModel, states, savedStates };
});

vi.mock('../../src/models/syncState', () => ({ default: mocks.SyncStateModel }));
vi.mock('../../src/services/syncPersistence', () => mocks.persistence);
vi.mock('../../src/models/repository', () => ({ default: mocks.RepositoryModel }));

import { SyncService, resetInFlightSyncs, runSync } from '../../src/services/sync.service';
import { registerProvider, resetProviders } from '../../src/domain/registry';

const USER = 'user-1';
const TOKEN = 'Bearer demo-token';

const emptyPage = <T>(overrides: Partial<ProviderPage<T>> = {}): ProviderPage<T> => ({
  items: [],
  nextCursor: null,
  etag: null,
  notModified: false,
  rateLimit: null,
  ...overrides,
});

const repo = (id: string, name: string) => ({
  externalId: id,
  name,
  fullName: `octo-labs/${name}`,
  owner: 'octo-labs',
  description: null,
  url: null,
  defaultBranch: 'main',
  isPrivate: false,
  isFork: false,
  isArchived: false,
  language: 'TypeScript',
  topics: [],
  stars: 0,
  forks: 0,
  openIssues: 0,
  sizeKb: 0,
  pushedAt: new Date('2026-09-01T00:00:00Z'),
  createdAt: null,
  updatedAt: null,
});

/** A provider that answers from a script, recording every request it sees. */
class FakeProvider implements SourceProvider {
  readonly id = 'github';

  readonly displayName = 'GitHub';

  readonly calls: Array<{ resource: string; scope?: string; page: PageRequest }> = [];

  constructor(
    private readonly script: {
      repositories?: Array<ProviderPage<any>>;
      commits?: (scope: RepositoryScope) => Array<ProviderPage<any>>;
      issues?: (scope: RepositoryScope) => Array<ProviderPage<any>>;
      pullRequests?: (scope: RepositoryScope) => Array<ProviderPage<any>>;
    },
  ) {}

  private cursors = new Map<string, number>();

  private next(key: string, pages: Array<ProviderPage<any>> | undefined): ProviderPage<any> {
    if (!pages || pages.length === 0) {
      return emptyPage();
    }
    const index = this.cursors.get(key) ?? 0;
    this.cursors.set(key, index + 1);
    return pages[Math.min(index, pages.length - 1)];
  }

  isConfigured(): boolean {
    return true;
  }

  buildAuthorizationUrl(): string {
    return 'https://example.invalid/authorize';
  }

  async exchangeCodeForToken(): Promise<string> {
    return TOKEN;
  }

  async getAuthenticatedAccount() {
    return {
      externalId: '1',
      username: 'octo',
      displayName: null,
      avatarUrl: null,
      profileUrl: null,
    };
  }

  async revokeToken(): Promise<void> {}

  async listRepositories(_token: string, page: PageRequest) {
    this.calls.push({ resource: 'repositories', page });
    return this.next('repositories', this.script.repositories);
  }

  async listCommits(_token: string, scope: RepositoryScope, page: PageRequest) {
    this.calls.push({ resource: 'commits', scope: scope.externalId, page });
    return this.next(`commits:${scope.externalId}`, this.script.commits?.(scope));
  }

  async listIssues(_token: string, scope: RepositoryScope, page: PageRequest) {
    this.calls.push({ resource: 'issues', scope: scope.externalId, page });
    return this.next(`issues:${scope.externalId}`, this.script.issues?.(scope));
  }

  async listPullRequests(_token: string, scope: RepositoryScope, page: PageRequest) {
    this.calls.push({ resource: 'pullRequests', scope: scope.externalId, page });
    return this.next(`pullRequests:${scope.externalId}`, this.script.pullRequests?.(scope));
  }
}

const stateFor = (resource: string, scopeId = '') =>
  mocks.savedStates.filter(
    (entry) => entry.filter.resource === resource && entry.filter.scopeId === scopeId,
  );

beforeEach(() => {
  mocks.states.clear();
  mocks.savedStates.length = 0;
  mocks.SyncStateModel.findOne.mockClear();
  mocks.SyncStateModel.findOneAndUpdate.mockClear();
  for (const fn of Object.values(mocks.persistence)) {
    (fn as any).mockClear();
  }
  resetInFlightSyncs();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('SyncService.run — pagination', () => {
  it('walks every page of the repository listing until the cursor runs out', async () => {
    const provider = new FakeProvider({
      repositories: [
        emptyPage({ items: [repo('1', 'a')], nextCursor: 'page-2', etag: '"first"' }),
        emptyPage({ items: [repo('2', 'b')], nextCursor: 'page-3' }),
        emptyPage({ items: [repo('3', 'c')], nextCursor: null }),
      ],
    });

    const report = await new SyncService(provider).run(USER, TOKEN);

    expect(report.totals.repositories).toBe(3);
    const repoCalls = provider.calls.filter((call) => call.resource === 'repositories');
    expect(repoCalls.map((call) => call.page.cursor)).toEqual([null, 'page-2', 'page-3']);
  });

  it('persists each page as it arrives rather than buffering the whole walk', async () => {
    const provider = new FakeProvider({
      repositories: [
        emptyPage({ items: [repo('1', 'a')], nextCursor: 'page-2' }),
        emptyPage({ items: [repo('2', 'b')], nextCursor: null }),
      ],
    });

    await new SyncService(provider).run(USER, TOKEN);

    expect(mocks.persistence.persistRepositories).toHaveBeenCalledTimes(2);
    expect(mocks.persistence.persistRepositories.mock.calls[0][2]).toHaveLength(1);
  });

  it('stops at the configured page cap instead of walking forever', async () => {
    // SYNC_MAX_PAGES is 5 in the test environment.
    const provider = new FakeProvider({
      repositories: [emptyPage({ items: [repo('1', 'a')], nextCursor: 'always-more' })],
    });

    const report = await new SyncService(provider).run(USER, TOKEN);

    expect(report.results[0].pagesFetched).toBe(5);
  });
});

describe('SyncService.run — conditional requests', () => {
  it('replays the stored ETag on the first page only', async () => {
    mocks.states.set('repositories:', { etag: '"stored"', lastSyncedAt: null });
    const provider = new FakeProvider({
      repositories: [
        emptyPage({ items: [repo('1', 'a')], nextCursor: 'page-2' }),
        emptyPage({ items: [], nextCursor: null }),
      ],
    });

    await new SyncService(provider).run(USER, TOKEN);

    const repoCalls = provider.calls.filter((call) => call.resource === 'repositories');
    expect(repoCalls[0].page.etag).toBe('"stored"');
    expect(repoCalls[1].page.etag).toBeNull();
  });

  it('records a 304 as not_modified and costs nothing downstream', async () => {
    mocks.states.set('repositories:', { etag: '"stored"', lastSyncedAt: null });
    const provider = new FakeProvider({
      repositories: [emptyPage({ notModified: true, etag: '"stored"' })],
    });

    const report = await new SyncService(provider).run(USER, TOKEN);

    expect(report.conditionalHits).toBe(1);
    expect(report.results[0].status).toBe('not_modified');
    expect(mocks.persistence.persistRepositories).not.toHaveBeenCalled();
  });

  it('stores the ETag returned by the first page for the next run', async () => {
    const provider = new FakeProvider({
      repositories: [emptyPage({ items: [repo('1', 'a')], etag: '"fresh"' })],
    });

    await new SyncService(provider).run(USER, TOKEN);

    expect(stateFor('repositories')[0].update.etag).toBe('"fresh"');
  });

  it('ignores stored validators when asked for a full resync', async () => {
    mocks.states.set('repositories:', { etag: '"stored"', lastSyncedAt: new Date() });
    const provider = new FakeProvider({ repositories: [emptyPage({ items: [repo('1', 'a')] })] });

    const report = await new SyncService(provider).run(USER, TOKEN, { full: true });

    expect(report.mode).toBe('full');
    expect(provider.calls[0].page.etag).toBeNull();
  });
});

describe('SyncService.run — incremental watermark', () => {
  it('hands the stored watermark to the provider as `since`', async () => {
    const watermark = new Date('2026-09-01T00:00:00Z');
    mocks.states.set('commits:1', { etag: null, lastSyncedAt: watermark });

    const provider = new FakeProvider({ repositories: [emptyPage({ items: [repo('1', 'a')] })] });

    await new SyncService(provider).run(USER, TOKEN);

    const commitCall = provider.calls.find((call) => call.resource === 'commits');
    expect(commitCall?.page.since).toBe(watermark);
  });

  it('advances the watermark after a successful walk', async () => {
    const provider = new FakeProvider({ repositories: [emptyPage({ items: [repo('1', 'a')] })] });

    await new SyncService(provider).run(USER, TOKEN);

    expect(stateFor('commits', '1')[0].update.lastSyncedAt).toBeInstanceOf(Date);
  });

  it('does NOT advance the watermark when the walk failed', async () => {
    const provider = new FakeProvider({
      repositories: [emptyPage({ items: [repo('1', 'a')] })],
      commits: () => {
        throw new ProviderError('boom', { status: 500 });
      },
    });

    await new SyncService(provider).run(USER, TOKEN);

    const saved = stateFor('commits', '1')[0].update;
    expect(saved.lastStatus).toBe('error');
    expect(saved).not.toHaveProperty('lastSyncedAt');
  });

  it('sends no `since` for the repository listing, which has no watermark', async () => {
    mocks.states.set('repositories:', { etag: null, lastSyncedAt: new Date() });
    const provider = new FakeProvider({ repositories: [emptyPage({ items: [] })] });

    await new SyncService(provider).run(USER, TOKEN);

    expect(provider.calls[0].page.since).toBeNull();
  });
});

describe('SyncService.run — rate limiting', () => {
  it('stops paginating once the remaining quota reaches the floor', async () => {
    // SYNC_RATE_LIMIT_FLOOR defaults to 50.
    const provider = new FakeProvider({
      repositories: [
        emptyPage({
          items: [repo('1', 'a')],
          nextCursor: 'page-2',
          rateLimit: { limit: 5000, remaining: 10, resetAt: null },
        }),
      ],
    });

    const report = await new SyncService(provider).run(USER, TOKEN);

    expect(report.results[0].pagesFetched).toBe(1);
    expect(report.rateLimit?.remaining).toBe(10);
  });

  it('keeps paginating while there is healthy quota left', async () => {
    const provider = new FakeProvider({
      repositories: [
        emptyPage({
          items: [repo('1', 'a')],
          nextCursor: 'page-2',
          rateLimit: { limit: 5000, remaining: 4000, resetAt: null },
        }),
        emptyPage({ items: [repo('2', 'b')], nextCursor: null }),
      ],
    });

    const report = await new SyncService(provider).run(USER, TOKEN);

    expect(report.results[0].pagesFetched).toBe(2);
  });

  it('reports a rate-limited resource as a warning rather than failing the run', async () => {
    const provider = new FakeProvider({
      repositories: [emptyPage({ items: [repo('1', 'a')] })],
      issues: () => {
        throw new ProviderError('limited', { status: 403, rateLimited: true });
      },
    });

    const report = await new SyncService(provider).run(USER, TOKEN);

    expect(report.results.find((r) => r.resource === 'issues')?.status).toBe('rate_limited');
    expect(report.warnings.join(' ')).toMatch(/Rate limited/);
  });
});

describe('SyncService.run — failure isolation', () => {
  it('keeps syncing the other resources when one fails', async () => {
    const provider = new FakeProvider({
      repositories: [emptyPage({ items: [repo('1', 'a')] })],
      commits: () => {
        throw new ProviderError('boom', { status: 500 });
      },
    });

    const report = await new SyncService(provider).run(USER, TOKEN);

    const statuses = Object.fromEntries(report.results.map((r) => [r.resource, r.status]));
    expect(statuses.commits).toBe('error');
    expect(statuses.issues).toBe('ok');
    expect(statuses.pullRequests).toBe('ok');
  });

  it('abandons the run when the repository listing itself fails', async () => {
    const provider = new FakeProvider({
      repositories: [],
    });
    vi.spyOn(provider, 'listRepositories').mockRejectedValue(new ProviderError('down'));

    const report = await new SyncService(provider).run(USER, TOKEN);

    expect(report.results).toHaveLength(1);
    expect(report.results[0].status).toBe('error');
    expect(report.warnings[0]).toMatch(/nothing else was synced/);
  });

  it('reports no repositories as a warning, not an error', async () => {
    const provider = new FakeProvider({ repositories: [emptyPage({ items: [] })] });

    const report = await new SyncService(provider).run(USER, TOKEN);

    expect(report.warnings).toContain('No repositories available to sync.');
  });
});

describe('SyncService.run — report', () => {
  it('totals every resource it walked', async () => {
    const provider = new FakeProvider({
      repositories: [emptyPage({ items: [repo('1', 'a'), repo('2', 'b')] })],
      commits: (scope) => [emptyPage({ items: [{ externalId: `${scope.externalId}-c1` }] })],
      issues: () => [emptyPage({ items: [{ externalId: 'i1' }, { externalId: 'i2' }] })],
    });

    const report = await new SyncService(provider).run(USER, TOKEN);

    expect(report.totals).toMatchObject({
      repositories: 2,
      commits: 2,
      issues: 4,
      pullRequests: 0,
    });
    expect(report.mode).toBe('incremental');
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('honours a repository cap so one run cannot fan out without bound', async () => {
    const provider = new FakeProvider({
      repositories: [emptyPage({ items: [repo('1', 'a'), repo('2', 'b'), repo('3', 'c')] })],
    });

    const report = await new SyncService(provider).run(USER, TOKEN, { repositoryLimit: 2 });

    const scopes = new Set(
      report.results.filter((r) => r.resource === 'commits').map((r) => r.scopeId),
    );
    expect(scopes).toEqual(new Set(['1', '2']));
  });
});

describe('runSync single-flight', () => {
  beforeEach(() => {
    resetProviders();
  });

  it('collapses concurrent runs for the same user onto one', async () => {
    let listCalls = 0;
    const provider = new FakeProvider({ repositories: [emptyPage({ items: [] })] });
    const original = provider.listRepositories.bind(provider);
    provider.listRepositories = async (token, page) => {
      listCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return original(token, page);
    };
    registerProvider(provider);

    const [first, second] = await Promise.all([runSync(USER, TOKEN), runSync(USER, TOKEN)]);

    expect(listCalls).toBe(1);
    expect(first).toBe(second);
  });

  it('allows a fresh run once the previous one settles', async () => {
    const provider = new FakeProvider({ repositories: [emptyPage({ items: [] })] });
    registerProvider(provider);

    const first = await runSync(USER, TOKEN);
    const second = await runSync(USER, TOKEN);

    expect(second).not.toBe(first);
  });
});

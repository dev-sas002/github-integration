import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubProvider } from '../../src/providers/github/githubProvider';
import { GitHubResponse } from '../../src/providers/github/githubClient';
import { RepositoryScope } from '../../src/domain/types';
import { ProviderError } from '../../src/domain/provider';

/**
 * The provider is tested against a stub client rather than a stub network:
 * everything below asserts what it *asks the client for* and how it maps what
 * comes back.
 */
const response = <T>(data: T, overrides: Partial<GitHubResponse<T>> = {}): GitHubResponse<T> => ({
  status: 200,
  data,
  etag: null,
  nextUrl: null,
  rateLimit: { limit: null, remaining: null, resetAt: null },
  notModified: false,
  ...overrides,
});

const stubClient = () => ({ request: vi.fn() });

const REPO: RepositoryScope = {
  owner: 'octo-labs',
  name: 'ledger-core',
  externalId: '100000',
  fullName: 'octo-labs/ledger-core',
};

let client: ReturnType<typeof stubClient>;
let provider: GitHubProvider;

beforeEach(() => {
  client = stubClient();
  provider = new GitHubProvider(client as never);
});

describe('listRepositories', () => {
  it('asks for the pushed-first listing with the requested page size', async () => {
    client.request.mockResolvedValue(response([]));

    await provider.listRepositories('Bearer t', { pageSize: 50 });

    const config = client.request.mock.calls[0][0];
    expect(config.url).toBe('/user/repos');
    expect(config.params.per_page).toBe(50);
    expect(config.params.sort).toBe('pushed');
    expect(config.params.direction).toBe('desc');
  });

  it('clamps an over-large page size to the GitHub maximum of 100', async () => {
    client.request.mockResolvedValue(response([]));

    await provider.listRepositories('Bearer t', { pageSize: 5000 });

    expect(client.request.mock.calls[0][0].params.per_page).toBe(100);
  });

  it('maps the GitHub payload onto the neutral record shape', async () => {
    client.request.mockResolvedValue(
      response([
        {
          id: 42,
          name: 'ledger-core',
          full_name: 'octo-labs/ledger-core',
          owner: { login: 'octo-labs' },
          description: 'A ledger',
          html_url: 'https://github.com/octo-labs/ledger-core',
          default_branch: 'main',
          private: true,
          fork: false,
          archived: false,
          language: 'TypeScript',
          topics: ['ledger'],
          stargazers_count: 7,
          forks_count: 2,
          open_issues_count: 3,
          size: 900,
          pushed_at: '2026-09-01T10:00:00Z',
          created_at: '2024-01-01T10:00:00Z',
          updated_at: '2026-09-01T10:00:00Z',
        },
      ]),
    );

    const page = await provider.listRepositories('Bearer t', {});

    expect(page.items[0]).toMatchObject({
      externalId: '42',
      fullName: 'octo-labs/ledger-core',
      owner: 'octo-labs',
      isPrivate: true,
      language: 'TypeScript',
      stars: 7,
    });
    expect(page.items[0].pushedAt).toBeInstanceOf(Date);
  });

  it('follows the cursor URL verbatim and drops the rebuilt query string', async () => {
    client.request.mockResolvedValue(response([]));

    await provider.listRepositories('Bearer t', {
      cursor: 'https://api.github.com/user/repos?page=3&per_page=100',
    });

    const config = client.request.mock.calls[0][0];
    expect(config.url).toBe('https://api.github.com/user/repos?page=3&per_page=100');
    expect(config.params).toBeUndefined();
  });

  it('only sends the stored ETag on the first page of a listing', async () => {
    client.request.mockResolvedValue(response([]));

    await provider.listRepositories('Bearer t', { etag: '"v1"' });
    expect(client.request.mock.calls[0][0].etag).toBe('"v1"');

    await provider.listRepositories('Bearer t', {
      etag: '"v1"',
      cursor: 'https://api.github.com/user/repos?page=2',
    });
    expect(client.request.mock.calls[1][0].etag).toBeNull();
  });

  it('reports a 304 as not-modified with no items', async () => {
    client.request.mockResolvedValue(
      response(undefined as never, { notModified: true, status: 304, etag: '"v1"' }),
    );

    const page = await provider.listRepositories('Bearer t', { etag: '"v1"' });

    expect(page).toMatchObject({ notModified: true, items: [], nextCursor: null, etag: '"v1"' });
  });

  it('carries the next cursor through from the Link header', async () => {
    client.request.mockResolvedValue(
      response([], { nextUrl: 'https://api.github.com/user/repos?page=2' }),
    );

    const page = await provider.listRepositories('Bearer t', {});

    expect(page.nextCursor).toBe('https://api.github.com/user/repos?page=2');
  });
});

describe('listCommits', () => {
  it('passes the incremental watermark to GitHub as `since`', async () => {
    client.request.mockResolvedValue(response([]));
    const since = new Date('2026-09-01T00:00:00.000Z');

    await provider.listCommits('Bearer t', REPO, { since });

    expect(client.request.mock.calls[0][0].params.since).toBe('2026-09-01T00:00:00.000Z');
  });

  it('omits `since` entirely on a full sync', async () => {
    client.request.mockResolvedValue(response([]));

    await provider.listCommits('Bearer t', REPO, { since: null });

    expect(client.request.mock.calls[0][0].params.since).toBeUndefined();
  });

  it('stamps every commit with the repository it came from', async () => {
    client.request.mockResolvedValue(
      response([
        {
          sha: 'abc123',
          html_url: 'https://github.com/octo-labs/ledger-core/commit/abc123',
          commit: {
            message: 'Fix the walk\nlong body',
            author: { name: 'Rosa', email: 'rosa@example.invalid', date: '2026-09-02T10:00:00Z' },
          },
          author: { login: 'rmartinez' },
        },
      ]),
    );

    const page = await provider.listCommits('Bearer t', REPO, {});

    expect(page.items[0]).toMatchObject({
      externalId: 'abc123',
      repositoryExternalId: '100000',
      repositoryFullName: 'octo-labs/ledger-core',
      authorLogin: 'rmartinez',
    });
  });

  it('treats an empty repository (409) as zero commits, not a failure', async () => {
    client.request.mockResolvedValue(response([] as never, { status: 409 }));

    await expect(provider.listCommits('Bearer t', REPO, {})).resolves.toMatchObject({
      items: [],
      nextCursor: null,
    });
  });
});

describe('listIssues', () => {
  it('drops pull requests, which GitHub returns from the issues endpoint', async () => {
    client.request.mockResolvedValue(
      response([
        { id: 1, number: 1, title: 'A real issue', state: 'open', user: { login: 'ylin' } },
        {
          id: 2,
          number: 2,
          title: 'Actually a PR',
          state: 'open',
          pull_request: { url: 'https://api.github.com/repos/o/r/pulls/2' },
        },
      ]),
    );

    const page = await provider.listIssues('Bearer t', REPO, {});

    expect(page.items).toHaveLength(1);
    expect(page.items[0].title).toBe('A real issue');
  });

  it('flattens label objects into names', async () => {
    client.request.mockResolvedValue(
      response([
        {
          id: 1,
          number: 1,
          title: 'x',
          state: 'closed',
          labels: [{ name: 'bug' }, { name: 'p1' }],
        },
      ]),
    );

    const page = await provider.listIssues('Bearer t', REPO, {});

    expect(page.items[0].labels).toEqual(['bug', 'p1']);
    expect(page.items[0].state).toBe('closed');
  });
});

describe('listPullRequests', () => {
  it('classifies a merged pull request as merged, not closed', async () => {
    client.request.mockResolvedValue(
      response([
        {
          id: 9,
          number: 9,
          title: 'Merge me',
          state: 'closed',
          merged_at: '2026-09-01T10:00:00Z',
          updated_at: '2026-09-01T10:00:00Z',
        },
      ]),
    );

    const page = await provider.listPullRequests('Bearer t', REPO, {});

    expect(page.items[0].state).toBe('merged');
  });

  it('applies the watermark client-side, because /pulls has no `since`', async () => {
    client.request.mockResolvedValue(
      response([
        { id: 1, number: 1, title: 'fresh', state: 'open', updated_at: '2026-09-10T00:00:00Z' },
        { id: 2, number: 2, title: 'old', state: 'open', updated_at: '2026-08-01T00:00:00Z' },
      ]),
    );

    const page = await provider.listPullRequests('Bearer t', REPO, {
      since: new Date('2026-09-01T00:00:00Z'),
    });

    expect(page.items.map((pr) => pr.title)).toEqual(['fresh']);
    // The filter is ours; GitHub was never asked for a `since` it does not support.
    expect(client.request.mock.calls[0][0].params.since).toBeUndefined();
  });

  it('ends the walk once a page reaches back past the watermark', async () => {
    client.request.mockResolvedValue(
      response(
        [
          { id: 1, number: 1, title: 'fresh', state: 'open', updated_at: '2026-09-10T00:00:00Z' },
          { id: 2, number: 2, title: 'old', state: 'open', updated_at: '2026-08-01T00:00:00Z' },
        ],
        { nextUrl: 'https://api.github.com/repositories/1/pulls?page=2' },
      ),
    );

    const page = await provider.listPullRequests('Bearer t', REPO, {
      since: new Date('2026-09-01T00:00:00Z'),
    });

    expect(page.nextCursor).toBeNull();
  });

  it('keeps walking while every record on the page is newer than the watermark', async () => {
    const next = 'https://api.github.com/repositories/1/pulls?page=2';
    client.request.mockResolvedValue(
      response(
        [{ id: 1, number: 1, title: 'fresh', state: 'open', updated_at: '2026-09-10T00:00:00Z' }],
        { nextUrl: next },
      ),
    );

    const page = await provider.listPullRequests('Bearer t', REPO, {
      since: new Date('2026-09-01T00:00:00Z'),
    });

    expect(page.nextCursor).toBe(next);
  });
});

describe('revokeToken', () => {
  it('sends the raw token under basic auth, not the stored Bearer value', async () => {
    client.request.mockResolvedValue(response({}, { status: 204 }));

    await provider.revokeToken('Bearer gho_secret');

    const config = client.request.mock.calls[0][0];
    expect(config.method).toBe('DELETE');
    expect(config.data).toEqual({ access_token: 'gho_secret' });
    expect(String(config.headers.Authorization)).toMatch(/^Basic /);
  });

  it('resolves when GitHub has already forgotten the token', async () => {
    client.request.mockRejectedValue(new ProviderError('gone', { status: 404 }));

    await expect(provider.revokeToken('Bearer x')).resolves.toBeUndefined();
  });

  it('still fails loudly when revocation breaks for any other reason', async () => {
    client.request.mockRejectedValue(new ProviderError('boom', { status: 500 }));

    await expect(provider.revokeToken('Bearer x')).rejects.toThrow('boom');
  });
});

describe('getAuthenticatedAccount', () => {
  it('rejects a response with no id or login rather than persisting a blank user', async () => {
    client.request.mockResolvedValue(response({}));

    await expect(provider.getAuthenticatedAccount('Bearer t')).rejects.toThrow(/id\/login/);
  });

  it('maps the account payload', async () => {
    client.request.mockResolvedValue(
      response({
        id: 7,
        login: 'octocat',
        name: 'Octo',
        avatar_url: 'https://a',
        html_url: 'https://h',
      }),
    );

    await expect(provider.getAuthenticatedAccount('Bearer t')).resolves.toEqual({
      externalId: '7',
      username: 'octocat',
      displayName: 'Octo',
      avatarUrl: 'https://a',
      profileUrl: 'https://h',
    });
  });
});

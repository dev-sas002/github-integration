import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Transport-level tests for the GitHub client. `axios.request` is replaced at
 * the module boundary, so nothing here can reach the network.
 */
const mocks = vi.hoisted(() => ({
  axios: {
    request: vi.fn(),
    post: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    isAxiosError: (error: any) => Boolean(error && error.isAxiosError),
  },
}));

vi.mock('axios', () => ({ default: mocks.axios }));

import {
  GitHubClient,
  isRateLimitResponse,
  parseNextLink,
  parseRateLimit,
  retryAfterSeconds,
} from '../../src/providers/github/githubClient';
import { ProviderError } from '../../src/domain/provider';

const ok = (data: unknown, headers: Record<string, string> = {}, status = 200) => ({
  status,
  data,
  headers,
});

const axiosError = (status: number, headers: Record<string, string> = {}, data: unknown = {}) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, headers, data },
  });

beforeEach(() => {
  mocks.axios.request.mockReset();
});

describe('parseNextLink', () => {
  it('extracts the rel="next" URL', () => {
    const header =
      '<https://api.github.com/user/repos?page=2>; rel="next", <https://api.github.com/user/repos?page=9>; rel="last"';

    expect(parseNextLink(header)).toBe('https://api.github.com/user/repos?page=2');
  });

  it('returns null on the last page, where only prev/first are present', () => {
    const header =
      '<https://api.github.com/user/repos?page=8>; rel="prev", <https://api.github.com/user/repos?page=1>; rel="first"';

    expect(parseNextLink(header)).toBeNull();
  });

  it('returns null when there is no Link header at all', () => {
    expect(parseNextLink(null)).toBeNull();
  });

  it('is not confused by a URL containing the word next', () => {
    const header = '<https://api.github.com/repos/o/next-thing/commits?page=3>; rel="last"';

    expect(parseNextLink(header)).toBeNull();
  });
});

describe('parseRateLimit', () => {
  it('reads the quota triple from the headers', () => {
    expect(
      parseRateLimit({
        'x-ratelimit-limit': '5000',
        'x-ratelimit-remaining': '4831',
        'x-ratelimit-reset': '1700000000',
      }),
    ).toEqual({ limit: 5000, remaining: 4831, resetAt: 1700000000 });
  });

  it('returns nulls when the provider sends no quota headers', () => {
    expect(parseRateLimit({})).toEqual({ limit: null, remaining: null, resetAt: null });
  });
});

describe('isRateLimitResponse', () => {
  it('treats 429 as rate limited', () => {
    expect(isRateLimitResponse(429, {})).toBe(true);
  });

  it('treats 403 with no quota left as rate limited', () => {
    expect(isRateLimitResponse(403, { 'x-ratelimit-remaining': '0' })).toBe(true);
  });

  it('treats a 403 carrying Retry-After as a secondary rate limit', () => {
    expect(isRateLimitResponse(403, { 'retry-after': '60' })).toBe(true);
  });

  it('treats a plain 403 with quota remaining as an ordinary refusal', () => {
    expect(isRateLimitResponse(403, { 'x-ratelimit-remaining': '2500' })).toBe(false);
  });

  it('never treats a 404 as rate limited', () => {
    expect(isRateLimitResponse(404, {})).toBe(false);
  });
});

describe('retryAfterSeconds', () => {
  it('prefers an explicit Retry-After', () => {
    expect(retryAfterSeconds({ 'retry-after': '45' })).toBe(45);
  });

  it('derives the wait from x-ratelimit-reset when Retry-After is absent', () => {
    const reset = Math.floor(Date.now() / 1000) + 120;

    expect(retryAfterSeconds({ 'x-ratelimit-reset': String(reset) })).toBeGreaterThan(100);
  });

  it('returns null when neither header is present', () => {
    expect(retryAfterSeconds({})).toBeNull();
  });
});

describe('GitHubClient.request', () => {
  const client = new GitHubClient('https://api.github.com', 10_000);

  it('resolves a relative path against the configured base URL', async () => {
    mocks.axios.request.mockResolvedValue(ok([]));

    await client.request({ url: '/user/repos' });

    expect(mocks.axios.request.mock.calls[0][0].url).toBe('https://api.github.com/user/repos');
  });

  it('passes an absolute cursor URL through untouched', async () => {
    mocks.axios.request.mockResolvedValue(ok([]));

    await client.request({ url: 'https://api.github.com/user/repos?page=4' });

    expect(mocks.axios.request.mock.calls[0][0].url).toBe(
      'https://api.github.com/user/repos?page=4',
    );
  });

  it('sends the versioned Accept header, a user agent and the token', async () => {
    mocks.axios.request.mockResolvedValue(ok([]));

    await client.request({ url: '/user', token: 'Bearer gho_x' });

    const { headers } = mocks.axios.request.mock.calls[0][0];
    expect(headers.Accept).toBe('application/vnd.github+json');
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect(headers['User-Agent']).toBe('github-integration-sync');
    expect(headers.Authorization).toBe('Bearer gho_x');
  });

  it('sends If-None-Match when an ETag is supplied', async () => {
    mocks.axios.request.mockResolvedValue(ok([], { etag: '"abc"' }));

    await client.request({ url: '/user/repos', etag: '"abc"' });

    expect(mocks.axios.request.mock.calls[0][0].headers['If-None-Match']).toBe('"abc"');
  });

  it('omits If-None-Match entirely when there is no stored ETag', async () => {
    mocks.axios.request.mockResolvedValue(ok([]));

    await client.request({ url: '/user/repos' });

    expect(mocks.axios.request.mock.calls[0][0].headers).not.toHaveProperty('If-None-Match');
  });

  it('accepts 304 as a success rather than an error', async () => {
    mocks.axios.request.mockResolvedValue(ok(undefined, { etag: '"abc"' }, 304));

    const response = await client.request({ url: '/user/repos', etag: '"abc"' });

    expect(response.notModified).toBe(true);
    expect(response.etag).toBe('"abc"');
  });

  it('treats a 304 as valid in validateStatus so axios does not reject it', async () => {
    mocks.axios.request.mockResolvedValue(ok([], {}, 200));

    await client.request({ url: '/user/repos' });

    const { validateStatus } = mocks.axios.request.mock.calls[0][0];
    expect(validateStatus(200)).toBe(true);
    expect(validateStatus(304)).toBe(true);
    expect(validateStatus(404)).toBe(false);
  });

  it('widens validateStatus with the caller-supplied allow list', async () => {
    mocks.axios.request.mockResolvedValue(ok([], {}, 200));

    await client.request({ url: '/repos/o/r/commits', allowStatuses: [409] });

    expect(mocks.axios.request.mock.calls[0][0].validateStatus(409)).toBe(true);
  });

  it('surfaces the next-page URL and the quota snapshot', async () => {
    mocks.axios.request.mockResolvedValue(
      ok([{ id: 1 }], {
        link: '<https://api.github.com/user/repos?page=2>; rel="next"',
        etag: '"page-1"',
        'x-ratelimit-remaining': '4000',
      }),
    );

    const response = await client.request<Array<{ id: number }>>({ url: '/user/repos' });

    expect(response.nextUrl).toBe('https://api.github.com/user/repos?page=2');
    expect(response.etag).toBe('"page-1"');
    expect(response.rateLimit.remaining).toBe(4000);
  });

  it('wraps a rate-limited refusal in a ProviderError that says so', async () => {
    mocks.axios.request.mockRejectedValue(
      axiosError(403, { 'x-ratelimit-remaining': '0', 'retry-after': '30' }),
    );

    await expect(client.request({ url: '/user/repos' })).rejects.toMatchObject({
      name: 'ProviderError',
      status: 403,
      rateLimited: true,
      retryable: true,
      retryAfterSeconds: 30,
    });
  });

  it('marks a 404 as neither retryable nor rate limited', async () => {
    mocks.axios.request.mockRejectedValue(axiosError(404));

    const error = await client.request({ url: '/repos/o/missing' }).catch((e) => e);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error.retryable).toBe(false);
    expect(error.rateLimited).toBe(false);
  });

  it('marks a 500 as retryable', async () => {
    mocks.axios.request.mockRejectedValue(axiosError(500));

    await expect(client.request({ url: '/user' })).rejects.toMatchObject({ retryable: true });
  });

  it('includes the upstream message in the error text', async () => {
    mocks.axios.request.mockRejectedValue(axiosError(422, {}, { message: 'Validation Failed' }));

    await expect(client.request({ url: '/user' })).rejects.toThrow(/Validation Failed/);
  });
});

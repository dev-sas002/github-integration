import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import appConfig from '../../config/appConfig';
import { ProviderError } from '../../domain/provider';
import { RateLimitSnapshot } from '../../domain/types';
import { withRetry } from '../../lib/backoff';
import logger from '../../lib/logger';

export interface GitHubRequest {
  /** Absolute URL, or a path resolved against `GITHUB_API_BASE_URL`. */
  url: string;
  method?: 'GET' | 'POST' | 'DELETE';
  token?: string | null;
  /** Sent as `If-None-Match`; a 304 answer costs no rate-limit quota. */
  etag?: string | null;
  params?: Record<string, string | number | undefined>;
  data?: unknown;
  headers?: Record<string, string>;
  /** Treat these statuses as a normal result instead of an error. */
  allowStatuses?: number[];
}

export interface GitHubResponse<T> {
  status: number;
  data: T;
  etag: string | null;
  /** URL of the `rel="next"` page from the `Link` header, when there is one. */
  nextUrl: string | null;
  rateLimit: RateLimitSnapshot;
  notModified: boolean;
}

const API_VERSION = '2022-11-28';

const headerValue = (headers: unknown, name: string): string | null => {
  if (!headers || typeof headers !== 'object') {
    return null;
  }
  const value = (headers as Record<string, unknown>)[name];
  if (value === undefined || value === null) {
    return null;
  }
  return Array.isArray(value) ? String(value[0]) : String(value);
};

const numberHeader = (headers: unknown, name: string): number | null => {
  const raw = headerValue(headers, name);
  if (raw === null) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

export const parseRateLimit = (headers: unknown): RateLimitSnapshot => ({
  limit: numberHeader(headers, 'x-ratelimit-limit'),
  remaining: numberHeader(headers, 'x-ratelimit-remaining'),
  resetAt: numberHeader(headers, 'x-ratelimit-reset'),
});

/**
 * Extracts the `rel="next"` URL from a GitHub `Link` header.
 *
 * GitHub paginates with `Link` rather than an offset the client computes, and
 * following it is the only correct way to walk a list: page numbers drift when
 * records are inserted mid-walk, the header does not.
 */
export const parseNextLink = (linkHeader: string | null): string | null => {
  if (!linkHeader) {
    return null;
  }

  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (match) {
      return match[1];
    }
  }

  return null;
};

/** True when GitHub refused the call because a quota — primary or secondary — is spent. */
export const isRateLimitResponse = (status: number | undefined, headers: unknown): boolean => {
  if (status === 429) {
    return true;
  }
  if (status !== 403) {
    return false;
  }
  const remaining = headerValue(headers, 'x-ratelimit-remaining');
  if (remaining === '0') {
    return true;
  }
  // Secondary rate limits answer 403 with a Retry-After and full primary quota.
  return headerValue(headers, 'retry-after') !== null;
};

export const retryAfterSeconds = (headers: unknown): number | null => {
  const retryAfter = numberHeader(headers, 'retry-after');
  if (retryAfter !== null && retryAfter > 0) {
    return Math.ceil(retryAfter);
  }

  const reset = numberHeader(headers, 'x-ratelimit-reset');
  if (reset !== null && reset > 0) {
    return Math.max(1, Math.ceil(reset - Date.now() / 1000));
  }

  return null;
};

const RETRYABLE_STATUSES = new Set([408, 500, 502, 503, 504]);

const toProviderError = (error: unknown, url: string): ProviderError => {
  if (!axios.isAxiosError(error)) {
    return new ProviderError(`GitHub request failed: ${(error as Error).message}`, {
      retryable: false,
      cause: error,
    });
  }

  const axiosError = error as AxiosError<{ message?: string }>;
  const status = axiosError.response?.status ?? null;
  const headers = axiosError.response?.headers;
  const limited = isRateLimitResponse(status ?? undefined, headers);
  const transport = !axiosError.response;

  const upstreamMessage = axiosError.response?.data?.message ?? axiosError.message;

  return new ProviderError(`GitHub ${status ?? 'network'} for ${url}: ${upstreamMessage}`, {
    status,
    rateLimited: limited,
    retryable: limited || transport || (status !== null && RETRYABLE_STATUSES.has(status)),
    retryAfterSeconds: limited ? retryAfterSeconds(headers) : null,
    cause: error,
  });
};

/**
 * Thin, retrying wrapper over the GitHub REST API.
 *
 * It exists so that conditional requests, `Link` pagination, rate-limit
 * accounting and backoff live in exactly one place. `axios.request` is used
 * (rather than an `axios.create()` instance) so the whole surface is mockable
 * at the module boundary in tests — no test in this repo touches the network.
 */
export class GitHubClient {
  constructor(
    private readonly baseUrl: string = appConfig.githubApiBaseUrl,
    private readonly timeoutMs: number = appConfig.githubRequestTimeoutMs,
  ) {}

  private resolve(url: string): string {
    return /^https?:\/\//i.test(url)
      ? url
      : `${this.baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  async request<T>(input: GitHubRequest): Promise<GitHubResponse<T>> {
    const url = this.resolve(input.url);
    const allowed = new Set([...(input.allowStatuses ?? []), 304]);

    const config: AxiosRequestConfig = {
      url,
      method: input.method ?? 'GET',
      timeout: this.timeoutMs,
      params: input.params,
      data: input.data,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': 'github-integration-sync',
        ...(input.token ? { Authorization: input.token } : {}),
        ...(input.etag ? { 'If-None-Match': input.etag } : {}),
        ...input.headers,
      },
      // 304 is a success for a conditional request, not a failure.
      validateStatus: (status: number) => (status >= 200 && status < 300) || allowed.has(status),
    };

    // Failures are classified before they reach the retry loop, so the loop
    // only ever has to ask `error.retryable`.
    const send = async (): Promise<AxiosResponse<T>> => {
      try {
        return await axios.request<T>(config);
      } catch (error) {
        throw toProviderError(error, url);
      }
    };

    const response = await withRetry<AxiosResponse<T>>(send, {
      attempts: appConfig.syncMaxRetries,
      baseMs: appConfig.syncRetryBaseMs,
      label: `github ${input.method ?? 'GET'} ${url}`,
      isRetryable: (error) => error instanceof ProviderError && error.retryable,
      retryAfterMs: (error) =>
        error instanceof ProviderError && error.retryAfterSeconds
          ? error.retryAfterSeconds * 1000
          : null,
    }).catch((error: unknown) => {
      const providerError = error instanceof ProviderError ? error : toProviderError(error, url);
      logger.warn('github request failed', {
        url,
        status: providerError.status,
        rateLimited: providerError.rateLimited,
      });
      throw providerError;
    });

    const headers = response.headers;

    return {
      status: response.status,
      data: response.data,
      etag: headerValue(headers, 'etag'),
      nextUrl: parseNextLink(headerValue(headers, 'link')),
      rateLimit: parseRateLimit(headers),
      notModified: response.status === 304,
    };
  }
}

/**
 * Wraps a raw axios rejection into a `ProviderError` before it reaches the
 * retry loop. Exported so `GitHubClient` and the OAuth helpers classify
 * failures identically.
 */
export const asProviderError = toProviderError;

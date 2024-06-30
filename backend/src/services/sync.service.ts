import mongoose from 'mongoose';
import appConfig from '../config/appConfig';
import { ProviderError, SourceProvider } from '../domain/provider';
import { getProvider } from '../domain/registry';
import {
  PageRequest,
  ProviderPage,
  RateLimitSnapshot,
  RepositoryRecord,
  RepositoryScope,
  ResourceKind,
} from '../domain/types';
import { SyncStatus } from '../models/syncState';
import { mapWithConcurrency } from '../lib/concurrency';
import logger from '../lib/logger';
import SyncStateModel from '../models/syncState';
import {
  persistCommits,
  persistIssues,
  persistPullRequests,
  persistRepositories,
} from './syncPersistence';

export interface SyncOptions {
  /** Ignore stored watermarks and ETags and walk everything again. */
  full?: boolean;
  /** Cap on repositories whose children are synced in this run. */
  repositoryLimit?: number;
}

export interface ResourceSyncResult {
  resource: ResourceKind;
  scopeId: string;
  scopeName: string;
  pagesFetched: number;
  fetched: number;
  upserted: number;
  notModified: boolean;
  /**
   * `partial` means the walk stopped early (page cap or quota floor) with more
   * pages upstream; the next run resumes from where this one stopped.
   */
  status: SyncStatus;
  error?: string;
  /** Upstream's `Retry-After` for a rate-limited resource, when it sent one. */
  retryAfterSeconds?: number;
}

export interface SyncReport {
  provider: string;
  mode: 'full' | 'incremental';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totals: Record<ResourceKind, number>;
  pagesFetched: number;
  /** Listings GitHub answered with 304 — fetched for free, no quota spent. */
  conditionalHits: number;
  rateLimit: RateLimitSnapshot | null;
  results: ResourceSyncResult[];
  warnings: string[];
}

/** One sync run per user at a time; a second request joins the run in flight. */
const inFlight = new Map<string, Promise<SyncReport>>();

interface WalkInput<T> {
  resource: ResourceKind;
  scopeId: string;
  scopeName: string;
  since: Date | null;
  etag: string | null;
  /** Where an earlier, truncated walk stopped; the walk continues from there. */
  resumeCursor: string | null;
  fetchPage: (page: PageRequest) => Promise<ProviderPage<T>>;
  persist: (items: T[]) => Promise<{ upserted: number }>;
}

interface WalkOutput<T> {
  result: ResourceSyncResult;
  items: T[];
  etag: string | null;
  /** Set when the walk stopped with pages left upstream. */
  remainingCursor: string | null;
  rateLimit: RateLimitSnapshot | null;
}

interface StoredState {
  etag: string | null;
  lastSyncedAt: Date | null;
  resumeCursor: string | null;
  pendingWatermark: Date | null;
}

/**
 * Orchestrates fetch → paginate → rate-limit → persist → record watermark.
 *
 * The service is written purely against the `SourceProvider` seam and the
 * persistence helpers; it has no idea GitHub exists. That is what keeps the
 * pipeline testable without a network and reusable for a second provider.
 */
export class SyncService {
  private lastRateLimit: RateLimitSnapshot | null = null;

  constructor(private readonly provider: SourceProvider) {}

  /**
   * Walks one paginated listing to completion (or to the page cap), persisting
   * each page as it arrives so a failure halfway through still leaves the data
   * it already fetched behind.
   */
  private async walk<T>(input: WalkInput<T>): Promise<WalkOutput<T>> {
    const collected: T[] = [];
    let cursor: string | null = input.resumeCursor;
    let pagesFetched = 0;
    let upserted = 0;
    let etag = input.etag;
    let rateLimit: RateLimitSnapshot | null = null;

    for (let page = 0; page < appConfig.syncMaxPages; page += 1) {
      const response: ProviderPage<T> = await input.fetchPage({
        cursor,
        pageSize: appConfig.syncPageSize,
        // The validator only applies to the first page of a fresh walk; a
        // resumed walk starts mid-listing, where it means nothing.
        etag: page === 0 && !input.resumeCursor ? input.etag : null,
        since: input.since,
      });

      rateLimit = response.rateLimit ?? rateLimit;
      this.lastRateLimit = rateLimit ?? this.lastRateLimit;

      if (response.notModified) {
        // Nothing upstream has changed since the last run. GitHub does not
        // charge quota for a 304, so this is the cheapest possible outcome.
        return {
          result: {
            resource: input.resource,
            scopeId: input.scopeId,
            scopeName: input.scopeName,
            pagesFetched: 0,
            fetched: 0,
            upserted: 0,
            notModified: true,
            status: 'not_modified',
          },
          items: [],
          etag: response.etag ?? input.etag,
          remainingCursor: null,
          rateLimit,
        };
      }

      pagesFetched += 1;

      if (page === 0 && !input.resumeCursor && response.etag) {
        etag = response.etag;
      }

      if (response.items.length > 0) {
        collected.push(...response.items);
        const written = await input.persist(response.items);
        upserted += written.upserted;
      }

      cursor = response.nextCursor;

      if (!cursor) {
        break;
      }

      if (this.shouldPauseForQuota(rateLimit)) {
        logger.warn('stopping pagination to preserve rate-limit headroom', {
          resource: input.resource,
          scopeName: input.scopeName,
          remaining: rateLimit?.remaining,
        });
        break;
      }
    }

    return {
      result: {
        resource: input.resource,
        scopeId: input.scopeId,
        scopeName: input.scopeName,
        pagesFetched,
        fetched: collected.length,
        upserted,
        notModified: false,
        status: cursor ? 'partial' : 'ok',
      },
      items: collected,
      etag,
      remainingCursor: cursor,
      rateLimit,
    };
  }

  /**
   * Leaves headroom in the hourly quota for interactive traffic. A background
   * sync that drains the budget makes every OAuth callback fail.
   */
  private shouldPauseForQuota(rateLimit: RateLimitSnapshot | null): boolean {
    return (
      rateLimit?.remaining !== null &&
      rateLimit?.remaining !== undefined &&
      rateLimit.remaining <= appConfig.syncRateLimitFloor
    );
  }

  private async loadState(
    userId: mongoose.Types.ObjectId | string,
    resource: ResourceKind,
    scopeId: string,
  ): Promise<StoredState> {
    const state = await SyncStateModel.findOne({
      userId,
      provider: this.provider.id,
      resource,
      scopeId,
    }).lean();

    return {
      etag: (state?.etag as string | null) ?? null,
      lastSyncedAt: (state?.lastSyncedAt as Date | null) ?? null,
      resumeCursor: (state?.resumeCursor as string | null) ?? null,
      pendingWatermark: (state?.pendingWatermark as Date | null) ?? null,
    };
  }

  /**
   * Records the outcome of one walk.
   *
   * The watermark only moves when a listing has been walked to its end. A
   * failed walk keeps everything as it was. A truncated walk keeps the old
   * watermark and ETag and stores the cursor it stopped at, so the next run
   * picks up the remaining pages instead of declaring them synced; the
   * watermark it eventually advances to is the start of the first run in
   * that chain, so nothing changed upstream in between is skipped.
   */
  private async saveState(
    userId: mongoose.Types.ObjectId | string,
    result: ResourceSyncResult,
    previous: StoredState,
    walk: { etag: string | null; remainingCursor: string | null } | null,
    syncedAt: Date,
  ): Promise<void> {
    const outcome = {
      lastStatus: result.status,
      lastError: result.error ?? null,
      recordCount: result.fetched,
    };

    let progress: Record<string, unknown> = {};

    if (walk && result.status === 'partial') {
      progress = {
        resumeCursor: walk.remainingCursor,
        pendingWatermark: previous.pendingWatermark ?? syncedAt,
      };
    } else if (walk) {
      progress = {
        etag: walk.etag,
        lastSyncedAt: previous.pendingWatermark ?? syncedAt,
        resumeCursor: null,
        pendingWatermark: null,
      };
    }

    await SyncStateModel.findOneAndUpdate(
      { userId, provider: this.provider.id, resource: result.resource, scopeId: result.scopeId },
      { $set: { ...outcome, ...progress } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  /** Turns any failure into a recorded, non-fatal result for one resource. */
  private static toFailure(
    resource: ResourceKind,
    scopeId: string,
    scopeName: string,
    error: unknown,
  ): ResourceSyncResult {
    const limited = error instanceof ProviderError && error.rateLimited;
    return {
      resource,
      scopeId,
      scopeName,
      pagesFetched: 0,
      fetched: 0,
      upserted: 0,
      notModified: false,
      status: limited ? 'rate_limited' : 'error',
      error: (error as Error).message,
      ...(limited && error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
    };
  }

  async run(
    userId: mongoose.Types.ObjectId | string,
    token: string,
    options: SyncOptions = {},
  ): Promise<SyncReport> {
    const startedAt = new Date();
    const full = Boolean(options.full);
    const results: ResourceSyncResult[] = [];
    const warnings: string[] = [];

    // --- 1. Repositories: the account-wide listing -------------------------
    const repoState = await this.loadState(userId, 'repositories', '');
    let repositories: RepositoryRecord[];

    try {
      const resumeCursor = full ? null : repoState.resumeCursor;
      const walked = await this.walk<RepositoryRecord>({
        resource: 'repositories',
        scopeId: '',
        scopeName: this.provider.displayName,
        since: null,
        etag: full ? null : repoState.etag,
        resumeCursor,
        fetchPage: (page) => this.provider.listRepositories(token, page),
        persist: (items) => persistRepositories(userId, this.provider.id, items, startedAt),
      });

      // Only a walk that saw the whole listing from its first page knows the
      // full set of repositories; otherwise the stored ones are used.
      repositories = walked.result.status === 'ok' && !resumeCursor ? walked.items : [];
      results.push(walked.result);
      await this.saveState(userId, walked.result, repoState, walked, startedAt);
    } catch (error) {
      const failure = SyncService.toFailure('repositories', '', this.provider.displayName, error);
      results.push(failure);
      await this.saveState(userId, failure, repoState, null, startedAt);
      return this.finish(startedAt, full, results, [
        'Repository listing failed; nothing else was synced.',
      ]);
    }

    // A 304 on the repository listing means no repository changed, but child
    // resources still have their own validators, so the walk continues using
    // what is already stored.
    const scopes = await this.resolveScopes(userId, repositories, options.repositoryLimit);

    if (scopes.length === 0) {
      warnings.push('No repositories available to sync.');
      return this.finish(startedAt, full, results, warnings);
    }

    // --- 2. Per-repository children, a few at a time ----------------------
    const childResults = await mapWithConcurrency(scopes, appConfig.syncConcurrency, (scope) =>
      this.syncRepositoryChildren(userId, token, scope, startedAt, full),
    );

    for (const group of childResults) {
      results.push(...group);
    }

    for (const result of results) {
      if (result.status === 'rate_limited') {
        warnings.push(
          `Rate limited while syncing ${result.resource} for ${result.scopeName}; it will resume on the next run.`,
        );
      } else if (result.status === 'partial') {
        warnings.push(
          `Stopped early on ${result.resource} for ${result.scopeName}; the next run continues from the last page fetched.`,
        );
      }
    }

    return this.finish(startedAt, full, results, warnings);
  }

  /**
   * Chooses which repositories to walk. A complete fresh listing wins;
   * otherwise (a 304, or a listing walked only in part) the stored
   * repositories are used, so commits, issues and pull requests still refresh.
   */
  private async resolveScopes(
    userId: mongoose.Types.ObjectId | string,
    listed: readonly RepositoryRecord[],
    limit?: number,
  ): Promise<RepositoryScope[]> {
    const source: RepositoryScope[] = listed.length
      ? listed.map((repo) => ({
          owner: repo.owner,
          name: repo.name,
          externalId: repo.externalId,
          fullName: repo.fullName,
        }))
      : await this.storedScopes(userId);

    const cap = limit && limit > 0 ? limit : source.length;
    return source.slice(0, cap);
  }

  private async storedScopes(userId: mongoose.Types.ObjectId | string): Promise<RepositoryScope[]> {
    // Imported lazily so the sync service does not pull the read models into
    // every consumer of this module.
    const { default: RepositoryModel } = await import('../models/repository');

    const stored = await RepositoryModel.find({ userId, provider: this.provider.id })
      .select({ owner: 1, name: 1, externalId: 1, fullName: 1 })
      .sort({ pushedAt: -1 })
      .lean();

    return stored.map((repo: Record<string, any>) => ({
      owner: String(repo.owner),
      name: String(repo.name),
      externalId: String(repo.externalId),
      fullName: String(repo.fullName),
    }));
  }

  private async syncRepositoryChildren(
    userId: mongoose.Types.ObjectId | string,
    token: string,
    scope: RepositoryScope,
    startedAt: Date,
    full: boolean,
  ): Promise<ResourceSyncResult[]> {
    const jobs: Array<{
      resource: ResourceKind;
      fetch: (page: PageRequest) => Promise<ProviderPage<any>>;
      persist: (items: any[]) => Promise<{ upserted: number }>;
    }> = [
      {
        resource: 'commits',
        fetch: (page) => this.provider.listCommits(token, scope, page),
        persist: (items) => persistCommits(userId, this.provider.id, items),
      },
      {
        resource: 'issues',
        fetch: (page) => this.provider.listIssues(token, scope, page),
        persist: (items) => persistIssues(userId, this.provider.id, items),
      },
      {
        resource: 'pullRequests',
        fetch: (page) => this.provider.listPullRequests(token, scope, page),
        persist: (items) => persistPullRequests(userId, this.provider.id, items),
      },
    ];

    const results: ResourceSyncResult[] = [];

    for (const job of jobs) {
      const state = await this.loadState(userId, job.resource, scope.externalId);

      try {
        const walked = await this.walk({
          resource: job.resource,
          scopeId: scope.externalId,
          scopeName: scope.fullName,
          since: full ? null : state.lastSyncedAt,
          etag: full ? null : state.etag,
          resumeCursor: full ? null : state.resumeCursor,
          fetchPage: job.fetch,
          persist: job.persist,
        });

        results.push(walked.result);
        await this.saveState(userId, walked.result, state, walked, startedAt);
      } catch (error) {
        const failure = SyncService.toFailure(
          job.resource,
          scope.externalId,
          scope.fullName,
          error,
        );
        logger.error('resource sync failed', {
          resource: job.resource,
          repository: scope.fullName,
          message: failure.error,
        });
        results.push(failure);
        await this.saveState(userId, failure, state, null, startedAt);
      }
    }

    return results;
  }

  private finish(
    startedAt: Date,
    full: boolean,
    results: ResourceSyncResult[],
    warnings: string[],
  ): SyncReport {
    const finishedAt = new Date();
    const totals: Record<ResourceKind, number> = {
      repositories: 0,
      commits: 0,
      issues: 0,
      pullRequests: 0,
    };

    let pagesFetched = 0;
    let conditionalHits = 0;

    for (const result of results) {
      totals[result.resource] += result.fetched;
      pagesFetched += result.pagesFetched;
      if (result.notModified) {
        conditionalHits += 1;
      }
    }

    return {
      provider: this.provider.id,
      mode: full ? 'full' : 'incremental',
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      totals,
      pagesFetched,
      conditionalHits,
      rateLimit: this.lastRateLimit,
      results,
      warnings,
    };
  }
}

/**
 * Entry point used by the HTTP layer. Collapses concurrent requests for the
 * same user onto one run — a double-clicked "Sync now" must not double the
 * API spend.
 */
export const runSync = (
  userId: mongoose.Types.ObjectId | string,
  token: string,
  options: SyncOptions = {},
  providerId = 'github',
): Promise<SyncReport> => {
  const key = `${providerId}:${String(userId)}`;
  const existing = inFlight.get(key);

  if (existing) {
    logger.info('joining sync already in flight', { key });
    return existing;
  }

  const provider = getProvider(providerId);
  const run = new SyncService(provider)
    .run(userId, token, options)
    .finally(() => inFlight.delete(key));

  inFlight.set(key, run);
  return run;
};

/** Test helper: clears the single-flight map between cases. */
export const resetInFlightSyncs = (): void => inFlight.clear();

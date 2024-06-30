import mongoose, { FilterQuery } from 'mongoose';
import appConfig from '../config/appConfig';
import CommitModel from '../models/commit';
import IssueModel from '../models/issue';
import PullRequestModel from '../models/pullRequest';
import RepositoryModel from '../models/repository';
import SyncStateModel from '../models/syncState';

type Id = mongoose.Types.ObjectId | string;

export interface PageQuery {
  page?: number;
  limit?: number;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
}

/**
 * Normalises and *clamps* paging input.
 *
 * An unbounded `?limit=` is the classic way to turn a healthy endpoint into an
 * accidental denial of service, so the cap is enforced server-side rather than
 * trusted from the client.
 */
export const resolvePaging = (query: PageQuery): { page: number; limit: number; skip: number } => {
  const page = Math.max(1, Math.trunc(Number(query.page)) || 1);
  const requested = Math.trunc(Number(query.limit)) || appConfig.defaultPageSize;
  const limit = Math.min(Math.max(requested, 1), appConfig.maxPageSize);

  return { page, limit, skip: (page - 1) * limit };
};

/**
 * The slice of the mongoose `Model` surface the paginator actually uses.
 *
 * Declaring it structurally (rather than importing `Model<any>`) keeps the
 * helper independent of any one schema and makes it trivial to stub in tests.
 */
interface PaginatedQuery {
  select(projection: Record<string, 0 | 1>): PaginatedQuery;
  sort(sort: Record<string, 1 | -1>): PaginatedQuery;
  skip(skip: number): PaginatedQuery;
  limit(limit: number): PaginatedQuery;
  lean(): Promise<unknown[]>;
}

export interface PaginatableModel {
  find(filter: FilterQuery<unknown>): PaginatedQuery;
  countDocuments(filter: FilterQuery<unknown>): Promise<number>;
}

const paginate = async <T>(
  model: PaginatableModel,
  filter: FilterQuery<unknown>,
  projection: Record<string, 0 | 1>,
  sort: Record<string, 1 | -1>,
  query: PageQuery,
): Promise<Paginated<T>> => {
  const { page, limit, skip } = resolvePaging(query);

  // The count and the page are independent; issuing them together halves the
  // wall-clock latency of every list endpoint.
  const [items, total] = await Promise.all([
    model
      .find(filter)
      .select(projection)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      // `lean()` skips hydrating full mongoose documents: these rows are
      // serialised straight to JSON and never mutated.
      .lean(),
    model.countDocuments(filter),
  ]);

  return {
    items: items as T[],
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    hasNext: skip + (items as T[]).length < total,
  };
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface RepositoryQuery extends PageQuery {
  q?: string;
  language?: string;
  sort?: 'pushed' | 'stars' | 'name';
}

const REPOSITORY_SORTS: Record<string, Record<string, 1 | -1>> = {
  pushed: { pushedAt: -1 },
  stars: { stars: -1 },
  name: { fullName: 1 },
};

export const listRepositories = (userId: Id, query: RepositoryQuery) => {
  const filter: FilterQuery<unknown> = { userId };

  if (query.q) {
    filter.fullName = { $regex: escapeRegex(query.q), $options: 'i' };
  }
  if (query.language) {
    filter.language = query.language;
  }

  return paginate(
    RepositoryModel as unknown as PaginatableModel,
    filter,
    { __v: 0, userId: 0 },
    REPOSITORY_SORTS[query.sort ?? 'pushed'] ?? REPOSITORY_SORTS.pushed,
    query,
  );
};

/**
 * Every language across the account's repositories, for the filter control.
 * Taken from the whole collection rather than the current page, so choosing
 * one language does not hide the others from the list.
 */
export const listRepositoryLanguages = async (userId: Id): Promise<string[]> => {
  const languages: unknown[] = await RepositoryModel.distinct('language', {
    userId,
    language: { $ne: null },
  });

  return languages
    .filter((language): language is string => typeof language === 'string' && language !== '')
    .sort((a, b) => a.localeCompare(b));
};

export interface CommitQuery extends PageQuery {
  repositoryId?: string;
  author?: string;
}

export const listCommits = (userId: Id, query: CommitQuery) => {
  const filter: FilterQuery<unknown> = { userId };

  if (query.repositoryId) {
    filter.repositoryExternalId = query.repositoryId;
  }
  if (query.author) {
    filter.authorLogin = query.author;
  }

  return paginate(
    CommitModel as unknown as PaginatableModel,
    filter,
    { __v: 0, userId: 0 },
    { committedAt: -1 },
    query,
  );
};

export interface IssueQuery extends PageQuery {
  repositoryId?: string;
  state?: 'open' | 'closed';
}

export const listIssues = (userId: Id, query: IssueQuery) => {
  const filter: FilterQuery<unknown> = { userId };

  if (query.repositoryId) {
    filter.repositoryExternalId = query.repositoryId;
  }
  if (query.state) {
    filter.state = query.state;
  }

  return paginate(
    IssueModel as unknown as PaginatableModel,
    filter,
    { __v: 0, userId: 0 },
    { remoteUpdatedAt: -1 },
    query,
  );
};

export interface PullRequestQuery extends PageQuery {
  repositoryId?: string;
  state?: 'open' | 'closed' | 'merged';
}

export const listPullRequests = (userId: Id, query: PullRequestQuery) => {
  const filter: FilterQuery<unknown> = { userId };

  if (query.repositoryId) {
    filter.repositoryExternalId = query.repositoryId;
  }
  if (query.state) {
    filter.state = query.state;
  }

  return paginate(
    PullRequestModel as unknown as PaginatableModel,
    filter,
    { __v: 0, userId: 0 },
    { remoteUpdatedAt: -1 },
    query,
  );
};

export interface OverviewCounts {
  repositories: number;
  commits: number;
  openIssues: number;
  openPullRequests: number;
  stalePullRequests: number;
}

export interface LanguageSlice {
  language: string;
  repositories: number;
}

export interface ActivityPoint {
  date: string;
  commits: number;
}

export interface Overview {
  counts: OverviewCounts;
  languages: LanguageSlice[];
  activity: ActivityPoint[];
  topRepositories: Array<{
    fullName: string;
    stars: number;
    language: string | null;
    commits: number;
  }>;
  lastSyncedAt: string | null;
}

/**
 * The dashboard payload.
 *
 * Every number here is produced by a Mongo aggregation rather than by loading
 * documents and counting them in Node — the difference between a query that
 * stays flat and one that grows with the size of the account.
 */
export const getOverview = async (userId: Id, days = 30): Promise<Overview> => {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const staleBefore = new Date(Date.now() - appConfig.stalePullRequestDays * 24 * 60 * 60 * 1000);

  const [
    repositories,
    commits,
    openIssues,
    openPullRequests,
    stalePullRequests,
    languages,
    activity,
    topRepositories,
    lastState,
  ] = await Promise.all([
    RepositoryModel.countDocuments({ userId }),
    CommitModel.countDocuments({ userId }),
    IssueModel.countDocuments({ userId, state: 'open' }),
    PullRequestModel.countDocuments({ userId, state: 'open' }),
    PullRequestModel.countDocuments({
      userId,
      state: 'open',
      remoteUpdatedAt: { $lt: staleBefore },
    }),
    RepositoryModel.aggregate([
      { $match: { userId: toObjectId(userId), language: { $ne: null } } },
      { $group: { _id: '$language', repositories: { $sum: 1 } } },
      { $sort: { repositories: -1, _id: 1 } },
      { $limit: 8 },
      { $project: { _id: 0, language: '$_id', repositories: 1 } },
    ]),
    CommitModel.aggregate([
      { $match: { userId: toObjectId(userId), committedAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$committedAt' } },
          commits: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, date: '$_id', commits: 1 } },
    ]),
    RepositoryModel.aggregate([
      { $match: { userId: toObjectId(userId) } },
      { $sort: { stars: -1, pushedAt: -1 } },
      { $limit: 5 },
      {
        // One lookup replaces the N+1 "count commits for each of the top five
        // repositories" loop this panel used to need.
        $lookup: {
          from: CommitModel.collection.name,
          let: { repoId: '$externalId', owner: '$userId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$repositoryExternalId', '$$repoId'] },
                    { $eq: ['$userId', '$$owner'] },
                  ],
                },
              },
            },
            { $count: 'total' },
          ],
          as: 'commitStats',
        },
      },
      {
        $project: {
          _id: 0,
          fullName: 1,
          stars: 1,
          language: 1,
          commits: { $ifNull: [{ $first: '$commitStats.total' }, 0] },
        },
      },
    ]),
    SyncStateModel.findOne({ userId })
      .sort({ lastSyncedAt: -1 })
      .select({ lastSyncedAt: 1 })
      .lean(),
  ]);

  return {
    counts: { repositories, commits, openIssues, openPullRequests, stalePullRequests },
    languages: languages as LanguageSlice[],
    activity: activity as ActivityPoint[],
    topRepositories: topRepositories as Overview['topRepositories'],
    lastSyncedAt: (lastState?.lastSyncedAt as Date | undefined)?.toISOString() ?? null,
  };
};

/** Aggregations match on the raw ObjectId, not the string form. */
function toObjectId(userId: Id): mongoose.Types.ObjectId | string {
  if (typeof userId !== 'string') {
    return userId;
  }
  return mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
}

export interface SyncStateView {
  resource: string;
  scopeId: string;
  lastSyncedAt: string | null;
  lastStatus: string;
  lastError: string | null;
  recordCount: number;
  hasEtag: boolean;
  /** True while a truncated walk is waiting to be continued by the next run. */
  resumePending: boolean;
}

/** Exposes the pipeline's resume points, which is what makes it debuggable. */
export const getSyncState = async (userId: Id): Promise<SyncStateView[]> => {
  const states = await SyncStateModel.find({ userId })
    .select({
      resource: 1,
      scopeId: 1,
      lastSyncedAt: 1,
      lastStatus: 1,
      lastError: 1,
      recordCount: 1,
      etag: 1,
      resumeCursor: 1,
    })
    .sort({ resource: 1, scopeId: 1 })
    .lean();

  return states.map((state: Record<string, any>) => ({
    resource: String(state.resource),
    scopeId: String(state.scopeId ?? ''),
    lastSyncedAt: state.lastSyncedAt ? new Date(state.lastSyncedAt).toISOString() : null,
    lastStatus: String(state.lastStatus ?? 'ok'),
    lastError: state.lastError ?? null,
    recordCount: Number(state.recordCount ?? 0),
    // The ETag itself is an opaque upstream value; only its presence is useful
    // to a reader, and not echoing it keeps the response free of cache tokens.
    hasEtag: Boolean(state.etag),
    resumePending: Boolean(state.resumeCursor),
  }));
};

/**
 * Provider-neutral shapes.
 *
 * Everything above the provider layer — services, models, controllers, the UI —
 * speaks only these types. A GitLab or Bitbucket provider added later maps its
 * own payloads into the same records and nothing downstream changes.
 */

export type ProviderId = 'github';

export interface ProviderAccount {
  externalId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
}

export interface RepositoryRecord {
  externalId: string;
  name: string;
  fullName: string;
  owner: string;
  description: string | null;
  url: string | null;
  defaultBranch: string;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  language: string | null;
  topics: string[];
  stars: number;
  forks: number;
  openIssues: number;
  sizeKb: number;
  pushedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface CommitRecord {
  externalId: string;
  repositoryExternalId: string;
  repositoryFullName: string;
  message: string;
  authorName: string | null;
  authorLogin: string | null;
  authorEmail: string | null;
  url: string | null;
  committedAt: Date | null;
}

export type IssueState = 'open' | 'closed';

export interface IssueRecord {
  externalId: string;
  repositoryExternalId: string;
  repositoryFullName: string;
  number: number;
  title: string;
  state: IssueState;
  authorLogin: string | null;
  labels: string[];
  comments: number;
  url: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  closedAt: Date | null;
}

export type PullRequestState = 'open' | 'closed' | 'merged';

export interface PullRequestRecord {
  externalId: string;
  repositoryExternalId: string;
  repositoryFullName: string;
  number: number;
  title: string;
  state: PullRequestState;
  isDraft: boolean;
  authorLogin: string | null;
  labels: string[];
  headRef: string | null;
  baseRef: string | null;
  url: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  closedAt: Date | null;
  mergedAt: Date | null;
}

/** The four resource families the sync pipeline knows how to walk. */
export type ResourceKind = 'repositories' | 'commits' | 'issues' | 'pullRequests';

/**
 * One page of upstream results plus the bookkeeping the pipeline needs to
 * resume: the opaque cursor for the next page and the caching validator for
 * this one.
 */
export interface ProviderPage<T> {
  items: T[];
  /** Opaque next-page token. `null` means this was the last page. */
  nextCursor: string | null;
  /** Entity tag for the page, replayed on the next run as `If-None-Match`. */
  etag: string | null;
  /** True when the provider answered 304: nothing changed, no quota spent. */
  notModified: boolean;
  /** Quota snapshot from the response headers, when the provider reports one. */
  rateLimit: RateLimitSnapshot | null;
}

export interface RateLimitSnapshot {
  limit: number | null;
  remaining: number | null;
  /** Unix seconds at which the window resets. */
  resetAt: number | null;
}

export interface PageRequest {
  /** Opaque cursor from a previous `ProviderPage`, or `null` for the first page. */
  cursor?: string | null;
  /** Items per page; the provider clamps it to whatever the upstream allows. */
  pageSize?: number;
  /** Conditional request validator from the previous run. */
  etag?: string | null;
  /** Incremental watermark — only records touched after this are requested. */
  since?: Date | null;
}

export interface RepositoryScope {
  owner: string;
  name: string;
  externalId: string;
  fullName: string;
}

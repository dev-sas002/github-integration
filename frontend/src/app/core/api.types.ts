/**
 * Wire types for the backend API.
 *
 * These mirror the provider-neutral records the backend persists — nothing in
 * the UI refers to a GitHub-specific payload shape, which is what lets a second
 * provider appear without touching a component.
 */

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
}

export interface Repository {
  externalId: string;
  name: string;
  fullName: string;
  owner: string;
  description: string | null;
  url: string | null;
  language: string | null;
  topics: string[];
  stars: number;
  forks: number;
  openIssues: number;
  isArchived: boolean;
  isPrivate: boolean;
  pushedAt: string | null;
}

export interface Commit {
  externalId: string;
  repositoryFullName: string;
  message: string;
  authorLogin: string | null;
  authorName: string | null;
  url: string | null;
  committedAt: string | null;
}

export interface Issue {
  externalId: string;
  repositoryFullName: string;
  number: number;
  title: string;
  state: 'open' | 'closed';
  labels: string[];
  url: string | null;
  remoteUpdatedAt: string | null;
}

export interface PullRequest {
  externalId: string;
  repositoryFullName: string;
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  isDraft: boolean;
  authorLogin: string | null;
  url: string | null;
  remoteUpdatedAt: string | null;
}

export interface Overview {
  counts: {
    repositories: number;
    commits: number;
    openIssues: number;
    openPullRequests: number;
    stalePullRequests: number;
  };
  languages: Array<{ language: string; repositories: number }>;
  activity: Array<{ date: string; commits: number }>;
  topRepositories: Array<{
    fullName: string;
    stars: number;
    language: string | null;
    commits: number;
  }>;
  lastSyncedAt: string | null;
}

export type SyncStatus = 'ok' | 'not_modified' | 'error' | 'rate_limited';

export interface SyncStateRow {
  resource: string;
  scopeId: string;
  lastSyncedAt: string | null;
  lastStatus: SyncStatus;
  lastError: string | null;
  recordCount: number;
  hasEtag: boolean;
}

export interface SyncReport {
  provider: string;
  mode: 'full' | 'incremental';
  durationMs: number;
  totals: { repositories: number; commits: number; issues: number; pullRequests: number };
  pagesFetched: number;
  conditionalHits: number;
  rateLimit: { limit: number | null; remaining: number | null; resetAt: number | null } | null;
  warnings: string[];
}

export type StaleSeverity = 'watch' | 'stale' | 'abandoned';

export interface StalePullRequest {
  externalId: string;
  number: number;
  title: string;
  repositoryFullName: string;
  authorLogin: string | null;
  url: string | null;
  isDraft: boolean;
  updatedAt: string | null;
  ageDays: number;
  severity: StaleSeverity;
  reason: string;
}

export interface StalePullRequestResponse {
  thresholdDays: number;
  items: StalePullRequest[];
}

export interface RepositoryInsight {
  repository: string;
  /** `model` when Claude wrote the prose, `heuristic` when it was computed locally. */
  source: 'model' | 'heuristic';
  headline: string;
  summary: string;
  highlights: string[];
  risks: string[];
  generatedAt: string;
  facts: {
    commitsLast30Days: number;
    commitsLast90Days: number;
    openIssues: number;
    closedIssues: number;
    openPullRequests: number;
    mergedPullRequests: number;
    stalePullRequests: number;
    contributors: Array<{ login: string; commits: number }>;
  };
}

export interface ProviderSummary {
  id: string;
  displayName: string;
  configured: boolean;
}

export interface DemoSession {
  token: string;
  username: string;
}

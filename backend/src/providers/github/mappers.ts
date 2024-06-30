import {
  CommitRecord,
  IssueRecord,
  IssueState,
  ProviderAccount,
  PullRequestRecord,
  PullRequestState,
  RepositoryRecord,
} from '../../domain/types';

/** GitHub sends ISO strings, nulls and the occasional missing key. */
const toDate = (value: unknown): Date | null => {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toStringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const toNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const toLabelNames = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((label) =>
      typeof label === 'string' ? label : toStringOrNull((label as { name?: unknown })?.name),
    )
    .filter((label): label is string => Boolean(label));
};

export const mapAccount = (raw: Record<string, unknown>): ProviderAccount => ({
  externalId: String(raw.id ?? ''),
  username: String(raw.login ?? ''),
  displayName: toStringOrNull(raw.name),
  avatarUrl: toStringOrNull(raw.avatar_url),
  profileUrl: toStringOrNull(raw.html_url),
});

export const mapRepository = (raw: Record<string, any>): RepositoryRecord => ({
  externalId: String(raw.id),
  name: String(raw.name ?? ''),
  fullName: String(raw.full_name ?? raw.name ?? ''),
  owner: String(raw.owner?.login ?? String(raw.full_name ?? '').split('/')[0] ?? ''),
  description: toStringOrNull(raw.description),
  url: toStringOrNull(raw.html_url),
  defaultBranch: String(raw.default_branch ?? 'main'),
  isPrivate: Boolean(raw.private),
  isFork: Boolean(raw.fork),
  isArchived: Boolean(raw.archived),
  language: toStringOrNull(raw.language),
  topics: Array.isArray(raw.topics) ? raw.topics.map(String) : [],
  stars: toNumber(raw.stargazers_count),
  forks: toNumber(raw.forks_count),
  openIssues: toNumber(raw.open_issues_count),
  sizeKb: toNumber(raw.size),
  pushedAt: toDate(raw.pushed_at),
  createdAt: toDate(raw.created_at),
  updatedAt: toDate(raw.updated_at),
});

export const mapCommit = (
  raw: Record<string, any>,
  repositoryExternalId: string,
  repositoryFullName: string,
): CommitRecord => ({
  externalId: String(raw.sha),
  repositoryExternalId,
  repositoryFullName,
  message: String(raw.commit?.message ?? ''),
  authorName: toStringOrNull(raw.commit?.author?.name),
  authorLogin: toStringOrNull(raw.author?.login),
  authorEmail: toStringOrNull(raw.commit?.author?.email),
  url: toStringOrNull(raw.html_url),
  committedAt: toDate(raw.commit?.author?.date ?? raw.commit?.committer?.date),
});

export const mapIssue = (
  raw: Record<string, any>,
  repositoryExternalId: string,
  repositoryFullName: string,
): IssueRecord => ({
  externalId: String(raw.id),
  repositoryExternalId,
  repositoryFullName,
  number: toNumber(raw.number),
  title: String(raw.title ?? ''),
  state: (raw.state === 'closed' ? 'closed' : 'open') as IssueState,
  authorLogin: toStringOrNull(raw.user?.login),
  labels: toLabelNames(raw.labels),
  comments: toNumber(raw.comments),
  url: toStringOrNull(raw.html_url),
  createdAt: toDate(raw.created_at),
  updatedAt: toDate(raw.updated_at),
  closedAt: toDate(raw.closed_at),
});

export const mapPullRequest = (
  raw: Record<string, any>,
  repositoryExternalId: string,
  repositoryFullName: string,
): PullRequestRecord => {
  const mergedAt = toDate(raw.merged_at);
  const state: PullRequestState = mergedAt ? 'merged' : raw.state === 'closed' ? 'closed' : 'open';

  return {
    externalId: String(raw.id),
    repositoryExternalId,
    repositoryFullName,
    number: toNumber(raw.number),
    title: String(raw.title ?? ''),
    state,
    isDraft: Boolean(raw.draft),
    authorLogin: toStringOrNull(raw.user?.login),
    labels: toLabelNames(raw.labels),
    headRef: toStringOrNull(raw.head?.ref),
    baseRef: toStringOrNull(raw.base?.ref),
    url: toStringOrNull(raw.html_url),
    createdAt: toDate(raw.created_at),
    updatedAt: toDate(raw.updated_at),
    closedAt: toDate(raw.closed_at),
    mergedAt,
  };
};

/**
 * GitHub's `GET /issues` endpoint returns pull requests as well — they are
 * issues with a `pull_request` key. Keeping them would double-count every PR.
 */
export const isPullRequestPayload = (raw: Record<string, unknown>): boolean =>
  Boolean(raw.pull_request);

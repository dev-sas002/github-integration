import mongoose from 'mongoose';
import appConfig from '../config/appConfig';
import { notFound } from '../lib/httpError';
import CommitModel from '../models/commit';
import IssueModel from '../models/issue';
import PullRequestModel from '../models/pullRequest';
import RepositoryModel from '../models/repository';
import llmClient from './ai/llmClient';

type Id = mongoose.Types.ObjectId | string;

const DAY_MS = 24 * 60 * 60 * 1000;

const daysBetween = (from: Date, to: Date): number =>
  Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));

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
  severity: 'watch' | 'stale' | 'abandoned';
  reason: string;
}

/**
 * Stale pull-request detection.
 *
 * Deliberately a rule, not a model: "open and untouched for N days" is exactly
 * what a reviewer wants flagged, it is explainable, it costs nothing, and it
 * works with no API key. The AI layer sits on top of facts like these rather
 * than replacing them.
 */
export const getStalePullRequests = async (userId: Id, limit = 20): Promise<StalePullRequest[]> => {
  const now = new Date();
  const threshold = new Date(now.getTime() - appConfig.stalePullRequestDays * DAY_MS);

  const rows = await PullRequestModel.find({
    userId,
    state: 'open',
    remoteUpdatedAt: { $lt: threshold },
  })
    .select({
      externalId: 1,
      number: 1,
      title: 1,
      repositoryFullName: 1,
      authorLogin: 1,
      url: 1,
      isDraft: 1,
      remoteUpdatedAt: 1,
    })
    .sort({ remoteUpdatedAt: 1 })
    .limit(Math.min(Math.max(limit, 1), 100))
    .lean();

  return rows.map((row: Record<string, any>) => {
    const updatedAt: Date | null = row.remoteUpdatedAt ? new Date(row.remoteUpdatedAt) : null;
    const ageDays = updatedAt ? daysBetween(updatedAt, now) : appConfig.stalePullRequestDays;
    const severity: StalePullRequest['severity'] =
      ageDays >= appConfig.stalePullRequestDays * 4
        ? 'abandoned'
        : ageDays >= appConfig.stalePullRequestDays * 2
          ? 'stale'
          : 'watch';

    return {
      externalId: String(row.externalId),
      number: Number(row.number),
      title: String(row.title ?? ''),
      repositoryFullName: String(row.repositoryFullName ?? ''),
      authorLogin: row.authorLogin ?? null,
      url: row.url ?? null,
      isDraft: Boolean(row.isDraft),
      updatedAt: updatedAt ? updatedAt.toISOString() : null,
      ageDays,
      severity,
      reason: row.isDraft
        ? `Draft, no activity for ${ageDays} days`
        : `Open with no activity for ${ageDays} days`,
    };
  });
};

export interface RepositoryFacts {
  fullName: string;
  description: string | null;
  language: string | null;
  stars: number;
  isArchived: boolean;
  lastPushedAt: string | null;
  commitsLast30Days: number;
  commitsLast90Days: number;
  contributors: Array<{ login: string; commits: number }>;
  openIssues: number;
  closedIssues: number;
  openPullRequests: number;
  mergedPullRequests: number;
  stalePullRequests: number;
  recentCommitMessages: string[];
}

export interface RepositoryInsight {
  repository: string;
  /** 'model' when Claude wrote the narrative, 'heuristic' when it was computed locally. */
  source: 'model' | 'heuristic';
  headline: string;
  summary: string;
  highlights: string[];
  risks: string[];
  facts: RepositoryFacts;
  generatedAt: string;
}

/** Collects everything the narrative is allowed to talk about. */
export const collectRepositoryFacts = async (
  userId: Id,
  repositoryExternalId: string,
): Promise<RepositoryFacts> => {
  const repository = await RepositoryModel.findOne({ userId, externalId: repositoryExternalId })
    .select({ fullName: 1, description: 1, language: 1, stars: 1, isArchived: 1, pushedAt: 1 })
    .lean();

  if (!repository) {
    throw notFound(`Repository ${repositoryExternalId} has not been synced`);
  }

  const now = Date.now();
  const since30 = new Date(now - 30 * DAY_MS);
  const since90 = new Date(now - 90 * DAY_MS);
  const staleBefore = new Date(now - appConfig.stalePullRequestDays * DAY_MS);
  const scope = { userId, repositoryExternalId };

  const [
    commitsLast30Days,
    commitsLast90Days,
    contributors,
    openIssues,
    closedIssues,
    openPullRequests,
    mergedPullRequests,
    stalePullRequests,
    recentCommits,
  ] = await Promise.all([
    CommitModel.countDocuments({ ...scope, committedAt: { $gte: since30 } }),
    CommitModel.countDocuments({ ...scope, committedAt: { $gte: since90 } }),
    CommitModel.aggregate([
      { $match: { ...scope, userId: toObjectId(userId), authorLogin: { $ne: null } } },
      { $group: { _id: '$authorLogin', commits: { $sum: 1 } } },
      { $sort: { commits: -1, _id: 1 } },
      { $limit: 5 },
      { $project: { _id: 0, login: '$_id', commits: 1 } },
    ]),
    IssueModel.countDocuments({ ...scope, state: 'open' }),
    IssueModel.countDocuments({ ...scope, state: 'closed' }),
    PullRequestModel.countDocuments({ ...scope, state: 'open' }),
    PullRequestModel.countDocuments({ ...scope, state: 'merged' }),
    PullRequestModel.countDocuments({
      ...scope,
      state: 'open',
      remoteUpdatedAt: { $lt: staleBefore },
    }),
    CommitModel.find(scope).select({ message: 1 }).sort({ committedAt: -1 }).limit(15).lean(),
  ]);

  return {
    fullName: String(repository.fullName),
    description: (repository.description as string | null) ?? null,
    language: (repository.language as string | null) ?? null,
    stars: Number(repository.stars ?? 0),
    isArchived: Boolean(repository.isArchived),
    lastPushedAt: repository.pushedAt ? new Date(repository.pushedAt as Date).toISOString() : null,
    commitsLast30Days,
    commitsLast90Days,
    contributors: contributors as Array<{ login: string; commits: number }>,
    openIssues,
    closedIssues,
    openPullRequests,
    mergedPullRequests,
    stalePullRequests,
    // Only the subject line is sent upstream; commit bodies can carry noise.
    recentCommitMessages: (recentCommits as Array<{ message?: string }>).map((commit) =>
      String(commit.message ?? '')
        .split('\n')[0]
        .slice(0, 160),
    ),
  };
};

/** The narrative produced with no API key: plain, derived entirely from counts. */
export const heuristicNarrative = (
  facts: RepositoryFacts,
): Pick<RepositoryInsight, 'headline' | 'summary' | 'highlights' | 'risks'> => {
  const cadence =
    facts.commitsLast30Days === 0
      ? 'no commits in the last 30 days'
      : `${facts.commitsLast30Days} commits in the last 30 days`;

  const highlights = [
    `${cadence} (${facts.commitsLast90Days} over 90 days).`,
    facts.contributors.length
      ? `Most active author: ${facts.contributors[0].login} (${facts.contributors[0].commits} commits).`
      : 'No attributable commit authors in the synced window.',
    `${facts.openPullRequests} open pull requests, ${facts.mergedPullRequests} merged.`,
  ];

  const risks: string[] = [];
  if (facts.isArchived) {
    risks.push('The repository is archived upstream.');
  }
  if (facts.stalePullRequests > 0) {
    risks.push(
      `${facts.stalePullRequests} pull request(s) open with no activity for over ${appConfig.stalePullRequestDays} days.`,
    );
  }
  if (facts.commitsLast30Days === 0 && facts.commitsLast90Days > 0) {
    risks.push('Commit activity has stopped in the last 30 days.');
  }
  if (facts.openIssues > 0 && facts.closedIssues === 0) {
    risks.push('Issues are being opened but none have been closed.');
  }

  const headline =
    facts.commitsLast30Days > 0
      ? `${facts.fullName} is actively developed`
      : `${facts.fullName} has gone quiet`;

  return {
    headline,
    summary: `${facts.fullName}${facts.language ? ` (${facts.language})` : ''} has ${cadence}, ${facts.openIssues} open issues and ${facts.openPullRequests} open pull requests.`,
    highlights,
    risks: risks.length ? risks : ['No risk signals detected in the synced data.'],
  };
};

const INSIGHT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'summary', 'highlights', 'risks'],
  properties: {
    headline: { type: 'string', description: 'One short sentence, under 80 characters.' },
    summary: { type: 'string', description: 'Two or three sentences of plain prose.' },
    highlights: { type: 'array', items: { type: 'string' }, maxItems: 4 },
    risks: { type: 'array', items: { type: 'string' }, maxItems: 4 },
  },
} as const;

const SYSTEM_PROMPT = [
  'You summarise engineering activity for a repository dashboard.',
  'You are given counts and commit subject lines that were synced from a code host.',
  'Describe only what the numbers support. Never invent contributors, dates or features.',
  'If the data is thin, say so. Be concrete and unexcited; no marketing language.',
].join(' ');

/** In-process cache: repeat views of the same repository must not re-bill a call. */
const narrativeCache = new Map<string, { expiresAt: number; value: RepositoryInsight }>();
const NARRATIVE_TTL_MS = 10 * 60 * 1000;

export const resetInsightCache = (): void => narrativeCache.clear();

/**
 * Repository summary.
 *
 * The facts are always computed locally. Claude is asked to turn them into
 * prose only when a key is configured; otherwise — and whenever the call fails
 * — the deterministic narrative is returned and the response says so in
 * `source`, so a reader always knows which they are looking at.
 */
export const getRepositoryInsight = async (
  userId: Id,
  repositoryExternalId: string,
  options: { refresh?: boolean } = {},
): Promise<RepositoryInsight> => {
  const cacheKey = `${String(userId)}:${repositoryExternalId}`;
  const cached = narrativeCache.get(cacheKey);

  if (!options.refresh && cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const facts = await collectRepositoryFacts(userId, repositoryExternalId);
  const fallback = heuristicNarrative(facts);

  const generated = await llmClient.complete<
    Omit<RepositoryInsight, 'repository' | 'source' | 'facts' | 'generatedAt'>
  >({
    system: SYSTEM_PROMPT,
    prompt: JSON.stringify(facts, null, 2),
    schema: INSIGHT_SCHEMA as unknown as Record<string, unknown>,
    // Thinking is on by default on Opus 5 and counts against max_tokens, so
    // this is sized for the reasoning plus the small JSON payload, not just
    // the payload.
    maxTokens: 16000,
  });

  const insight: RepositoryInsight = {
    repository: facts.fullName,
    source: generated ? 'model' : 'heuristic',
    headline: generated?.headline ?? fallback.headline,
    summary: generated?.summary ?? fallback.summary,
    highlights: generated?.highlights?.length ? generated.highlights : fallback.highlights,
    risks: generated?.risks?.length ? generated.risks : fallback.risks,
    facts,
    generatedAt: new Date().toISOString(),
  };

  narrativeCache.set(cacheKey, { expiresAt: Date.now() + NARRATIVE_TTL_MS, value: insight });

  return insight;
};

function toObjectId(userId: Id): mongoose.Types.ObjectId | string {
  if (typeof userId !== 'string') {
    return userId;
  }
  return mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
}

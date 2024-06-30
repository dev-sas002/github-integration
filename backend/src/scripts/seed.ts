/* eslint-disable no-console */
import mongoose from 'mongoose';
import appConfig from '../config/appConfig';
import CommitModel from '../models/commit';
import IntegrationModel from '../models/integration';
import IssueModel from '../models/issue';
import PullRequestModel from '../models/pullRequest';
import RepositoryModel from '../models/repository';
import SyncStateModel from '../models/syncState';
import UserModel from '../models/user';

/**
 * Seeds a demo account so the app is populated on first boot.
 *
 * Everything here is fabricated: the "access token" is the literal string
 * `demo-token` and no value in this file is, or resembles, a real credential.
 * The demo account exists purely so the dashboard has something to render
 * without anyone having to own a GitHub OAuth app.
 */

export const DEMO_TOKEN = 'Bearer demo-token';
const PROVIDER = 'github';
const DAY_MS = 24 * 60 * 60 * 1000;

const daysAgo = (days: number, hour = 12): Date => {
  const date = new Date(Date.now() - days * DAY_MS);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
};

interface RepoSpec {
  name: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  topics: string[];
  pushedDaysAgo: number;
  commitCount: number;
  commitSpanDays: number;
  issues: Array<{ title: string; state: 'open' | 'closed'; labels: string[]; ageDays: number }>;
  pulls: Array<{
    title: string;
    state: 'open' | 'closed' | 'merged';
    draft?: boolean;
    ageDays: number;
    updatedDaysAgo: number;
  }>;
}

const OWNER = 'octo-labs';

const REPO_SPECS: RepoSpec[] = [
  {
    name: 'ledger-core',
    description: 'Double-entry ledger service with an event-sourced write path.',
    language: 'TypeScript',
    stars: 412,
    forks: 38,
    topics: ['ledger', 'event-sourcing', 'fintech'],
    pushedDaysAgo: 0,
    commitCount: 96,
    commitSpanDays: 28,
    issues: [
      {
        title: 'Balance projection lags behind the event log under load',
        state: 'open',
        labels: ['bug', 'performance'],
        ageDays: 6,
      },
      { title: 'Document the reconciliation job', state: 'open', labels: ['docs'], ageDays: 12 },
      {
        title: 'Add idempotency keys to the posting endpoint',
        state: 'closed',
        labels: ['enhancement'],
        ageDays: 40,
      },
      {
        title: 'Decimal rounding differs between reports',
        state: 'closed',
        labels: ['bug'],
        ageDays: 55,
      },
    ],
    pulls: [
      {
        title: 'Batch projection writes into a single transaction',
        state: 'open',
        ageDays: 4,
        updatedDaysAgo: 1,
      },
      {
        title: 'Introduce a replay CLI for the event store',
        state: 'merged',
        ageDays: 21,
        updatedDaysAgo: 18,
      },
      {
        title: 'Split posting rules out of the controller',
        state: 'merged',
        ageDays: 34,
        updatedDaysAgo: 30,
      },
      {
        title: 'WIP: multi-currency postings',
        state: 'open',
        draft: true,
        ageDays: 71,
        updatedDaysAgo: 63,
      },
    ],
  },
  {
    name: 'atlas-gateway',
    description: 'Edge gateway: routing, auth, and per-tenant rate limiting.',
    language: 'Go',
    stars: 287,
    forks: 24,
    topics: ['gateway', 'rate-limiting', 'observability'],
    pushedDaysAgo: 2,
    commitCount: 74,
    commitSpanDays: 45,
    issues: [
      {
        title: 'Rate limiter buckets drift across replicas',
        state: 'open',
        labels: ['bug'],
        ageDays: 9,
      },
      {
        title: 'Expose upstream latency histograms',
        state: 'open',
        labels: ['enhancement', 'observability'],
        ageDays: 22,
      },
      { title: 'Drop the legacy /v0 router', state: 'closed', labels: ['chore'], ageDays: 61 },
    ],
    pulls: [
      { title: 'Move rate-limit state into Redis', state: 'open', ageDays: 33, updatedDaysAgo: 29 },
      { title: 'Add structured access logs', state: 'merged', ageDays: 15, updatedDaysAgo: 13 },
      {
        title: 'Retry idempotent upstream calls',
        state: 'closed',
        ageDays: 48,
        updatedDaysAgo: 44,
      },
    ],
  },
  {
    name: 'pulse-dashboard',
    description: 'Operational dashboard for the platform team.',
    language: 'TypeScript',
    stars: 156,
    forks: 11,
    topics: ['angular', 'dashboard'],
    pushedDaysAgo: 1,
    commitCount: 58,
    commitSpanDays: 30,
    issues: [
      {
        title: 'Charts flicker when the websocket reconnects',
        state: 'open',
        labels: ['bug', 'ui'],
        ageDays: 3,
      },
      {
        title: 'Dark theme contrast fails on the sparkline',
        state: 'open',
        labels: ['a11y'],
        ageDays: 17,
      },
      {
        title: 'Persist the selected time range',
        state: 'closed',
        labels: ['enhancement'],
        ageDays: 29,
      },
    ],
    pulls: [
      { title: 'Virtualise the activity table', state: 'open', ageDays: 5, updatedDaysAgo: 2 },
      { title: 'Replace the chart library', state: 'merged', ageDays: 26, updatedDaysAgo: 24 },
    ],
  },
  {
    name: 'sift-indexer',
    description: 'Incremental document indexer with a pluggable backend.',
    language: 'Python',
    stars: 203,
    forks: 31,
    topics: ['search', 'indexing'],
    pushedDaysAgo: 9,
    commitCount: 41,
    commitSpanDays: 70,
    issues: [
      {
        title: 'Re-index skips documents deleted mid-run',
        state: 'open',
        labels: ['bug'],
        ageDays: 26,
      },
      { title: 'Support snapshot restore', state: 'open', labels: ['enhancement'], ageDays: 44 },
    ],
    pulls: [
      {
        title: 'Checkpoint the cursor after every batch',
        state: 'open',
        ageDays: 52,
        updatedDaysAgo: 47,
      },
      { title: 'Add a dry-run mode', state: 'merged', ageDays: 38, updatedDaysAgo: 36 },
    ],
  },
  {
    name: 'harbor-ci',
    description: 'Self-hosted CI runner orchestration.',
    language: 'Rust',
    stars: 98,
    forks: 7,
    topics: ['ci', 'orchestration'],
    pushedDaysAgo: 16,
    commitCount: 27,
    commitSpanDays: 85,
    issues: [
      {
        title: 'Runner leases are not released on crash',
        state: 'open',
        labels: ['bug', 'reliability'],
        ageDays: 31,
      },
    ],
    pulls: [
      { title: 'Lease renewal with a heartbeat', state: 'open', ageDays: 64, updatedDaysAgo: 58 },
    ],
  },
  {
    name: 'copperplate',
    description: 'Shared design tokens and component primitives.',
    language: 'CSS',
    stars: 64,
    forks: 5,
    topics: ['design-system'],
    pushedDaysAgo: 34,
    commitCount: 18,
    commitSpanDays: 120,
    issues: [
      {
        title: 'Token names are inconsistent between web and mobile',
        state: 'open',
        labels: ['docs'],
        ageDays: 58,
      },
    ],
    pulls: [
      {
        title: 'Rename spacing scale to a t-shirt scale',
        state: 'open',
        ageDays: 90,
        updatedDaysAgo: 82,
      },
    ],
  },
];

const COMMIT_SUBJECTS = [
  'Handle partial page failures during resync',
  'Add index on (userId, pushedAt) for the repository listing',
  'Honour Retry-After when the secondary limit trips',
  'Extract the pagination walk into its own helper',
  'Fix off-by-one in the incremental watermark',
  'Cache the conditional ETag per listing, not per page',
  'Drop the unused legacy migration',
  'Tighten the provider error taxonomy',
  'Backfill missing author logins',
  'Reduce the default page size to 50',
  'Log the rate-limit snapshot after every run',
  'Skip archived repositories during the nightly walk',
];

const AUTHORS = [
  { login: 'rmartinez', name: 'Rosa Martinez', email: 'rosa@example.invalid' },
  { login: 'kwabena-a', name: 'Kwabena Asante', email: 'kwabena@example.invalid' },
  { login: 'ylin', name: 'Yue Lin', email: 'yue@example.invalid' },
  { login: 'dtanaka', name: 'Daichi Tanaka', email: 'daichi@example.invalid' },
];

/** Deterministic pseudo-random so repeated seeds produce identical screenshots. */
const makeRandom = (seed: number) => {
  let state = seed;
  return (): number => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
};

export const seed = async (): Promise<{
  repositories: number;
  commits: number;
  issues: number;
  pullRequests: number;
}> => {
  const random = makeRandom(20260923);

  await Promise.all([
    UserModel.deleteMany({ githubId: 'demo-1' }),
    RepositoryModel.deleteMany({ provider: PROVIDER }),
    CommitModel.deleteMany({ provider: PROVIDER }),
    IssueModel.deleteMany({ provider: PROVIDER }),
    PullRequestModel.deleteMany({ provider: PROVIDER }),
    SyncStateModel.deleteMany({ provider: PROVIDER }),
  ]);

  const user = await UserModel.create({
    username: 'octo-labs-demo',
    githubId: 'demo-1',
    accessToken: DEMO_TOKEN,
  });

  await IntegrationModel.findOneAndUpdate(
    { userId: user._id, provider: 'GitHub' },
    {
      connectedAt: daysAgo(12),
      accountLogin: 'octo-labs-demo',
      accountProfileUrl: `https://github.com/${OWNER}`,
    },
    { upsert: true, setDefaultsOnInsert: true },
  );

  const repositories: unknown[] = [];
  const commits: unknown[] = [];
  const issues: unknown[] = [];
  const pullRequests: unknown[] = [];
  const syncStates: unknown[] = [];

  REPO_SPECS.forEach((spec, repoIndex) => {
    const externalId = String(100000 + repoIndex);
    const fullName = `${OWNER}/${spec.name}`;

    repositories.push({
      userId: user._id,
      provider: PROVIDER,
      externalId,
      name: spec.name,
      fullName,
      owner: OWNER,
      description: spec.description,
      url: `https://github.com/${fullName}`,
      defaultBranch: 'main',
      isPrivate: false,
      isFork: false,
      isArchived: false,
      language: spec.language,
      topics: spec.topics,
      stars: spec.stars,
      forks: spec.forks,
      openIssues: spec.issues.filter((issue) => issue.state === 'open').length,
      sizeKb: 1200 + repoIndex * 430,
      pushedAt: daysAgo(spec.pushedDaysAgo, 9),
      remoteCreatedAt: daysAgo(500 + repoIndex * 40),
      remoteUpdatedAt: daysAgo(spec.pushedDaysAgo, 9),
      syncedAt: new Date(),
    });

    for (let i = 0; i < spec.commitCount; i += 1) {
      const author = AUTHORS[Math.floor(random() * AUTHORS.length)];
      const ageDays = Math.floor(random() * spec.commitSpanDays);

      commits.push({
        userId: user._id,
        provider: PROVIDER,
        externalId: `${externalId}-sha-${i.toString().padStart(4, '0')}`,
        repositoryExternalId: externalId,
        repositoryFullName: fullName,
        message: COMMIT_SUBJECTS[Math.floor(random() * COMMIT_SUBJECTS.length)],
        authorName: author.name,
        authorLogin: author.login,
        authorEmail: author.email,
        url: `https://github.com/${fullName}/commit/${i}`,
        committedAt: daysAgo(ageDays, Math.floor(random() * 20)),
      });
    }

    spec.issues.forEach((issue, index) => {
      issues.push({
        userId: user._id,
        provider: PROVIDER,
        externalId: `${externalId}-issue-${index}`,
        repositoryExternalId: externalId,
        repositoryFullName: fullName,
        number: 100 + index,
        title: issue.title,
        state: issue.state,
        authorLogin: AUTHORS[index % AUTHORS.length].login,
        labels: issue.labels,
        comments: Math.floor(random() * 9),
        url: `https://github.com/${fullName}/issues/${100 + index}`,
        remoteCreatedAt: daysAgo(issue.ageDays + 3),
        remoteUpdatedAt: daysAgo(
          issue.state === 'closed' ? issue.ageDays : Math.max(0, issue.ageDays - 2),
        ),
        closedAt: issue.state === 'closed' ? daysAgo(issue.ageDays) : null,
      });
    });

    spec.pulls.forEach((pull, index) => {
      pullRequests.push({
        userId: user._id,
        provider: PROVIDER,
        externalId: `${externalId}-pr-${index}`,
        repositoryExternalId: externalId,
        repositoryFullName: fullName,
        number: 200 + index,
        title: pull.title,
        state: pull.state,
        isDraft: Boolean(pull.draft),
        authorLogin: AUTHORS[(index + repoIndex) % AUTHORS.length].login,
        labels: pull.state === 'merged' ? ['ready'] : ['review-needed'],
        headRef: `feature/${pull.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .slice(0, 28)}`,
        baseRef: 'main',
        url: `https://github.com/${fullName}/pull/${200 + index}`,
        remoteCreatedAt: daysAgo(pull.ageDays),
        remoteUpdatedAt: daysAgo(pull.updatedDaysAgo),
        closedAt: pull.state === 'open' ? null : daysAgo(pull.updatedDaysAgo),
        mergedAt: pull.state === 'merged' ? daysAgo(pull.updatedDaysAgo) : null,
      });
    });

    for (const resource of ['commits', 'issues', 'pullRequests'] as const) {
      syncStates.push({
        userId: user._id,
        provider: PROVIDER,
        resource,
        scopeId: externalId,
        etag: `"seed-${externalId}-${resource}"`,
        lastSyncedAt: daysAgo(0, 8),
        lastStatus: 'ok',
        recordCount:
          resource === 'commits'
            ? spec.commitCount
            : resource === 'issues'
              ? spec.issues.length
              : spec.pulls.length,
      });
    }
  });

  syncStates.push({
    userId: user._id,
    provider: PROVIDER,
    resource: 'repositories',
    scopeId: '',
    etag: '"seed-repositories"',
    lastSyncedAt: daysAgo(0, 8),
    lastStatus: 'ok',
    recordCount: REPO_SPECS.length,
  });

  await Promise.all([
    RepositoryModel.insertMany(repositories),
    CommitModel.insertMany(commits),
    IssueModel.insertMany(issues),
    PullRequestModel.insertMany(pullRequests),
    SyncStateModel.insertMany(syncStates),
  ]);

  return {
    repositories: repositories.length,
    commits: commits.length,
    issues: issues.length,
    pullRequests: pullRequests.length,
  };
};

const main = async (): Promise<void> => {
  await mongoose.connect(appConfig.dbUrl);
  const counts = await seed();
  console.log(
    JSON.stringify({ message: 'seeded demo account', token: DEMO_TOKEN, ...counts }, null, 2),
  );
  await mongoose.connection.close();
};

if (require.main === module) {
  main().catch((error) => {
    console.error('seed failed:', error);
    process.exit(1);
  });
}

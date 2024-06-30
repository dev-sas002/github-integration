import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Insight tests.
 *
 * The models are in-memory doubles and the LLM client is replaced wholesale,
 * so nothing here reaches a database and — importantly — no test can make a
 * paid Anthropic call. The model path is exercised by stubbing `complete()`.
 */
const mocks = vi.hoisted(() => {
  const chain = (rows: any[]) => {
    const state: any = {};
    const builder: any = {
      select: (projection: any) => {
        state.projection = projection;
        return builder;
      },
      sort: (sort: any) => {
        state.sort = sort;
        return builder;
      },
      limit: (limit: number) => {
        state.limit = limit;
        return builder;
      },
      lean: async () => rows,
    };
    return { builder, state };
  };

  const calls: any = { pullRequestFind: [], repositoryFindOne: [] };

  const PullRequestModel: any = {
    rows: [] as any[],
    find: vi.fn((filter: any) => {
      const { builder, state } = chain(PullRequestModel.rows);
      state.filter = filter;
      calls.pullRequestFind.push(state);
      return builder;
    }),
    countDocuments: vi.fn(async () => 0),
  };

  const RepositoryModel: any = {
    doc: null as any,
    findOne: vi.fn((filter: any) => {
      calls.repositoryFindOne.push(filter);
      const { builder } = chain([]);
      builder.lean = async () => RepositoryModel.doc;
      return builder;
    }),
  };

  const CommitModel: any = {
    messages: [] as any[],
    counts: [0, 0],
    countDocuments: vi.fn(async () => CommitModel.counts.shift() ?? 0),
    aggregate: vi.fn(async () => CommitModel.contributors ?? []),
    contributors: [] as any[],
    find: vi.fn(() => chain(CommitModel.messages).builder),
  };

  const IssueModel: any = {
    counts: [0, 0],
    countDocuments: vi.fn(async () => IssueModel.counts.shift() ?? 0),
  };

  const llm = { isEnabled: vi.fn(() => false), complete: vi.fn(async () => null) };

  return { calls, PullRequestModel, RepositoryModel, CommitModel, IssueModel, llm };
});

vi.mock('../../src/models/pullRequest', () => ({ default: mocks.PullRequestModel }));
vi.mock('../../src/models/repository', () => ({ default: mocks.RepositoryModel }));
vi.mock('../../src/models/commit', () => ({ default: mocks.CommitModel }));
vi.mock('../../src/models/issue', () => ({ default: mocks.IssueModel }));
vi.mock('../../src/services/ai/llmClient', () => ({ default: mocks.llm, llmClient: mocks.llm }));

import appConfig from '../../src/config/appConfig';
import {
  collectRepositoryFacts,
  getRepositoryInsight,
  getStalePullRequests,
  heuristicNarrative,
  resetInsightCache,
  type RepositoryFacts,
} from '../../src/services/insights.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

const facts = (overrides: Partial<RepositoryFacts> = {}): RepositoryFacts => ({
  fullName: 'octo-labs/ledger-core',
  description: null,
  language: 'TypeScript',
  stars: 10,
  isArchived: false,
  lastPushedAt: null,
  commitsLast30Days: 12,
  commitsLast90Days: 40,
  contributors: [{ login: 'rmartinez', commits: 9 }],
  openIssues: 3,
  closedIssues: 7,
  openPullRequests: 2,
  mergedPullRequests: 5,
  stalePullRequests: 0,
  recentCommitMessages: [],
  ...overrides,
});

beforeEach(() => {
  resetInsightCache();
  mocks.PullRequestModel.rows = [];
  mocks.RepositoryModel.doc = null;
  mocks.CommitModel.counts = [0, 0];
  mocks.CommitModel.contributors = [];
  mocks.CommitModel.messages = [];
  mocks.IssueModel.counts = [0, 0];
  mocks.calls.pullRequestFind.length = 0;
  mocks.calls.repositoryFindOne.length = 0;
  mocks.llm.complete.mockResolvedValue(null);
});

describe('getStalePullRequests', () => {
  it('asks only for open pull requests untouched since the threshold', async () => {
    await getStalePullRequests('user-1');

    const [state] = mocks.calls.pullRequestFind;
    expect(state.filter.state).toBe('open');
    expect(state.filter.userId).toBe('user-1');
    const cutoff = state.filter.remoteUpdatedAt.$lt as Date;
    const expected = Date.now() - appConfig.stalePullRequestDays * DAY_MS;
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(5_000);
  });

  it('sorts oldest first so the worst offenders lead', async () => {
    await getStalePullRequests('user-1');
    expect(mocks.calls.pullRequestFind[0].sort).toEqual({ remoteUpdatedAt: 1 });
  });

  it('clamps the limit to a sane ceiling', async () => {
    await getStalePullRequests('user-1', 5000);
    expect(mocks.calls.pullRequestFind[0].limit).toBe(100);

    await getStalePullRequests('user-1', -3);
    expect(mocks.calls.pullRequestFind[1].limit).toBe(1);
  });

  it('grades severity by how long the pull request has been untouched', async () => {
    const threshold = appConfig.stalePullRequestDays;
    mocks.PullRequestModel.rows = [
      { externalId: 'a', number: 1, title: 'watch', remoteUpdatedAt: daysAgo(threshold + 1) },
      { externalId: 'b', number: 2, title: 'stale', remoteUpdatedAt: daysAgo(threshold * 2 + 1) },
      { externalId: 'c', number: 3, title: 'gone', remoteUpdatedAt: daysAgo(threshold * 4 + 1) },
    ];

    const result = await getStalePullRequests('user-1');

    expect(result.map((pr) => pr.severity)).toEqual(['watch', 'stale', 'abandoned']);
  });

  it('describes a draft differently from an open pull request', async () => {
    mocks.PullRequestModel.rows = [
      { externalId: 'a', number: 1, title: 'd', isDraft: true, remoteUpdatedAt: daysAgo(30) },
      { externalId: 'b', number: 2, title: 'o', isDraft: false, remoteUpdatedAt: daysAgo(30) },
    ];

    const [draft, open] = await getStalePullRequests('user-1');

    expect(draft.reason).toContain('Draft');
    expect(open.reason).toContain('Open');
    expect(draft.ageDays).toBe(30);
  });
});

describe('collectRepositoryFacts', () => {
  it('404s for a repository that was never synced', async () => {
    mocks.RepositoryModel.doc = null;

    await expect(collectRepositoryFacts('user-1', 'missing')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('keeps only the subject line of each recent commit', async () => {
    mocks.RepositoryModel.doc = { fullName: 'octo-labs/x', stars: 3 };
    mocks.CommitModel.messages = [{ message: `subject line\n\nlong body text` }];

    const collected = await collectRepositoryFacts('user-1', 'repo-1');

    expect(collected.recentCommitMessages).toEqual(['subject line']);
  });
});

describe('heuristicNarrative', () => {
  it('calls an actively developed repository active', () => {
    const narrative = heuristicNarrative(facts());
    expect(narrative.headline).toContain('actively developed');
    expect(narrative.risks).toEqual(['No risk signals detected in the synced data.']);
  });

  it('calls a repository with no recent commits quiet and flags the stall', () => {
    const narrative = heuristicNarrative(facts({ commitsLast30Days: 0, commitsLast90Days: 20 }));

    expect(narrative.headline).toContain('gone quiet');
    expect(narrative.risks.join(' ')).toContain('stopped');
  });

  it('flags archived repositories and stale pull requests', () => {
    const narrative = heuristicNarrative(facts({ isArchived: true, stalePullRequests: 4 }));
    const joined = narrative.risks.join(' ');

    expect(joined).toContain('archived');
    expect(joined).toContain('4 pull request(s)');
  });

  it('flags a repository where issues are opened but never closed', () => {
    const narrative = heuristicNarrative(facts({ openIssues: 6, closedIssues: 0 }));
    expect(narrative.risks.join(' ')).toContain('none have been closed');
  });

  it('copes with a repository that has no attributable authors', () => {
    const narrative = heuristicNarrative(facts({ contributors: [] }));
    expect(narrative.highlights.join(' ')).toContain('No attributable commit authors');
  });
});

describe('getRepositoryInsight', () => {
  beforeEach(() => {
    mocks.RepositoryModel.doc = { fullName: 'octo-labs/ledger-core', language: 'Go', stars: 5 };
  });

  it('falls back to the heuristic narrative when the model is unavailable', async () => {
    mocks.llm.complete.mockResolvedValue(null);

    const insight = await getRepositoryInsight('user-1', 'repo-1');

    expect(insight.source).toBe('heuristic');
    expect(insight.headline).toContain('octo-labs/ledger-core');
    expect(insight.facts.fullName).toBe('octo-labs/ledger-core');
  });

  it('uses the model narrative when one comes back, and says so', async () => {
    mocks.llm.complete.mockResolvedValue({
      headline: 'Steady maintenance',
      summary: 'A calm quarter.',
      highlights: ['One highlight'],
      risks: ['One risk'],
    });

    const insight = await getRepositoryInsight('user-1', 'repo-1');

    expect(insight.source).toBe('model');
    expect(insight.headline).toBe('Steady maintenance');
    expect(insight.highlights).toEqual(['One highlight']);
  });

  it('keeps the locally computed facts even when the model writes the prose', async () => {
    mocks.llm.complete.mockResolvedValue({
      headline: 'h',
      summary: 's',
      highlights: [],
      risks: [],
    });

    const insight = await getRepositoryInsight('user-1', 'repo-1');

    // Empty arrays from the model must not erase the deterministic content.
    expect(insight.highlights.length).toBeGreaterThan(0);
    expect(insight.risks.length).toBeGreaterThan(0);
  });

  it('serves a repeat view from cache rather than re-billing a call', async () => {
    await getRepositoryInsight('user-1', 'repo-1');
    await getRepositoryInsight('user-1', 'repo-1');

    expect(mocks.llm.complete).toHaveBeenCalledTimes(1);
  });

  it('bypasses the cache when the caller asks for a refresh', async () => {
    await getRepositoryInsight('user-1', 'repo-1');
    await getRepositoryInsight('user-1', 'repo-1', { refresh: true });

    expect(mocks.llm.complete).toHaveBeenCalledTimes(2);
  });

  it('caches per user, so one account never sees another account’s narrative', async () => {
    await getRepositoryInsight('user-1', 'repo-1');
    await getRepositoryInsight('user-2', 'repo-1');

    expect(mocks.llm.complete).toHaveBeenCalledTimes(2);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * These tests exist to pin down the single most important performance property
 * of the write path: a page of N records costs ONE database round trip, not N.
 */
const mocks = vi.hoisted(() => {
  const model = () => ({
    bulkWrite: vi.fn(async (ops: any[]) => ({ matchedCount: 0, upsertedCount: ops.length })),
    deleteMany: vi.fn(async () => ({ deletedCount: 0 })),
    collection: { name: 'things' },
  });

  return {
    RepositoryModel: model(),
    CommitModel: model(),
    IssueModel: model(),
    PullRequestModel: model(),
  };
});

vi.mock('../../src/models/repository', () => ({ default: mocks.RepositoryModel }));
vi.mock('../../src/models/commit', () => ({ default: mocks.CommitModel }));
vi.mock('../../src/models/issue', () => ({ default: mocks.IssueModel }));
vi.mock('../../src/models/pullRequest', () => ({ default: mocks.PullRequestModel }));

import {
  persistCommits,
  persistIssues,
  persistPullRequests,
  persistRepositories,
  purgeSyncedData,
} from '../../src/services/syncPersistence';

const repoRecord = (id: string) => ({
  externalId: id,
  name: `repo-${id}`,
  fullName: `octo-labs/repo-${id}`,
  owner: 'octo-labs',
  description: null,
  url: null,
  defaultBranch: 'main',
  isPrivate: false,
  isFork: false,
  isArchived: false,
  language: null,
  topics: [],
  stars: 0,
  forks: 0,
  openIssues: 0,
  sizeKb: 0,
  pushedAt: null,
  createdAt: null,
  updatedAt: null,
});

const commitRecord = (sha: string) => ({
  externalId: sha,
  repositoryExternalId: '1',
  repositoryFullName: 'octo-labs/a',
  message: 'm',
  authorName: null,
  authorLogin: null,
  authorEmail: null,
  url: null,
  committedAt: null,
});

beforeEach(() => {
  for (const model of Object.values(mocks)) {
    model.bulkWrite.mockClear();
    model.deleteMany.mockClear();
  }
});

describe('persistRepositories', () => {
  it('writes a whole page in a single bulkWrite', async () => {
    await persistRepositories(
      'u1',
      'github',
      [repoRecord('1'), repoRecord('2'), repoRecord('3')],
      new Date(),
    );

    expect(mocks.RepositoryModel.bulkWrite).toHaveBeenCalledTimes(1);
    expect(mocks.RepositoryModel.bulkWrite.mock.calls[0][0]).toHaveLength(3);
  });

  it('uses an unordered batch so one bad record cannot block the rest', async () => {
    await persistRepositories('u1', 'github', [repoRecord('1')], new Date());

    expect(mocks.RepositoryModel.bulkWrite.mock.calls[0][1]).toEqual({ ordered: false });
  });

  it('upserts on the (user, provider, externalId) identity', async () => {
    await persistRepositories('u1', 'github', [repoRecord('7')], new Date());

    const [op] = mocks.RepositoryModel.bulkWrite.mock.calls[0][0];
    expect(op.updateOne.filter).toEqual({ userId: 'u1', provider: 'github', externalId: '7' });
    expect(op.updateOne.upsert).toBe(true);
  });

  it('never rewrites the identity fields on an existing document', async () => {
    await persistRepositories('u1', 'github', [repoRecord('7')], new Date());

    const [op] = mocks.RepositoryModel.bulkWrite.mock.calls[0][0];
    expect(op.updateOne.update.$setOnInsert).toEqual({
      userId: 'u1',
      provider: 'github',
      externalId: '7',
    });
    expect(op.updateOne.update.$set).not.toHaveProperty('userId');
  });

  it('does not touch the database for an empty page', async () => {
    const result = await persistRepositories('u1', 'github', [], new Date());

    expect(mocks.RepositoryModel.bulkWrite).not.toHaveBeenCalled();
    expect(result).toEqual({ matched: 0, upserted: 0 });
  });
});

describe('persistCommits', () => {
  it('keys a commit by repository as well as SHA, because forks share SHAs', async () => {
    await persistCommits('u1', 'github', [commitRecord('abc')]);

    const [op] = mocks.CommitModel.bulkWrite.mock.calls[0][0];
    expect(op.updateOne.filter).toEqual({
      userId: 'u1',
      provider: 'github',
      repositoryExternalId: '1',
      externalId: 'abc',
    });
  });

  it('batches the whole page', async () => {
    await persistCommits('u1', 'github', [commitRecord('a'), commitRecord('b')]);

    expect(mocks.CommitModel.bulkWrite).toHaveBeenCalledTimes(1);
  });
});

describe('persistIssues / persistPullRequests', () => {
  it('upserts issues by external id', async () => {
    await persistIssues('u1', 'github', [
      {
        externalId: 'i1',
        repositoryExternalId: '1',
        repositoryFullName: 'octo-labs/a',
        number: 1,
        title: 't',
        state: 'open',
        authorLogin: null,
        labels: [],
        comments: 0,
        url: null,
        createdAt: null,
        updatedAt: null,
        closedAt: null,
      },
    ]);

    expect(mocks.IssueModel.bulkWrite.mock.calls[0][0][0].updateOne.filter.externalId).toBe('i1');
  });

  it('persists the merged state of a pull request', async () => {
    await persistPullRequests('u1', 'github', [
      {
        externalId: 'p1',
        repositoryExternalId: '1',
        repositoryFullName: 'octo-labs/a',
        number: 1,
        title: 't',
        state: 'merged',
        isDraft: false,
        authorLogin: null,
        labels: [],
        headRef: null,
        baseRef: null,
        url: null,
        createdAt: null,
        updatedAt: null,
        closedAt: null,
        mergedAt: new Date('2026-09-01T00:00:00Z'),
      },
    ]);

    const update = mocks.PullRequestModel.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(update.state).toBe('merged');
    expect(update.mergedAt).toBeInstanceOf(Date);
  });
});

describe('purgeSyncedData', () => {
  it('clears every synced collection for the user', async () => {
    await purgeSyncedData('u1');

    for (const model of Object.values(mocks)) {
      expect(model.deleteMany).toHaveBeenCalledWith({ userId: 'u1' });
    }
  });
});

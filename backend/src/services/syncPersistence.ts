import mongoose from 'mongoose';
import CommitModel from '../models/commit';
import IssueModel from '../models/issue';
import PullRequestModel from '../models/pullRequest';
import RepositoryModel from '../models/repository';
import { CommitRecord, IssueRecord, PullRequestRecord, RepositoryRecord } from '../domain/types';

type Id = mongoose.Types.ObjectId | string;

export interface PersistResult {
  matched: number;
  upserted: number;
}

interface BulkWritable {
  bulkWrite(
    ops: unknown[],
    options?: unknown,
  ): Promise<{
    matchedCount?: number;
    modifiedCount?: number;
    upsertedCount?: number;
  }>;
}

/**
 * Writes a whole page in one round trip.
 *
 * The naive version of this loop is `for (const item of items) await
 * Model.findOneAndUpdate(...)` — one network round trip per record, which on a
 * 100-item page is 100 sequential trips. `bulkWrite` with `ordered: false`
 * sends them as a single batch and lets the server apply them in parallel.
 */
const runBulk = async (model: BulkWritable, ops: unknown[]): Promise<PersistResult> => {
  if (ops.length === 0) {
    return { matched: 0, upserted: 0 };
  }

  const result = await model.bulkWrite(ops, { ordered: false });

  return {
    matched: result.matchedCount ?? 0,
    upserted: result.upsertedCount ?? 0,
  };
};

export const persistRepositories = (
  userId: Id,
  provider: string,
  items: readonly RepositoryRecord[],
  syncedAt: Date,
): Promise<PersistResult> =>
  runBulk(
    RepositoryModel as unknown as BulkWritable,
    items.map((item) => ({
      updateOne: {
        filter: { userId, provider, externalId: item.externalId },
        update: {
          $set: {
            name: item.name,
            fullName: item.fullName,
            owner: item.owner,
            description: item.description,
            url: item.url,
            defaultBranch: item.defaultBranch,
            isPrivate: item.isPrivate,
            isFork: item.isFork,
            isArchived: item.isArchived,
            language: item.language,
            topics: item.topics,
            stars: item.stars,
            forks: item.forks,
            openIssues: item.openIssues,
            sizeKb: item.sizeKb,
            pushedAt: item.pushedAt,
            remoteCreatedAt: item.createdAt,
            remoteUpdatedAt: item.updatedAt,
            syncedAt,
          },
          $setOnInsert: { userId, provider, externalId: item.externalId },
        },
        upsert: true,
      },
    })),
  );

export const persistCommits = (
  userId: Id,
  provider: string,
  items: readonly CommitRecord[],
): Promise<PersistResult> =>
  runBulk(
    CommitModel as unknown as BulkWritable,
    items.map((item) => ({
      updateOne: {
        filter: {
          userId,
          provider,
          repositoryExternalId: item.repositoryExternalId,
          externalId: item.externalId,
        },
        update: {
          $set: {
            repositoryFullName: item.repositoryFullName,
            message: item.message,
            authorName: item.authorName,
            authorLogin: item.authorLogin,
            authorEmail: item.authorEmail,
            url: item.url,
            committedAt: item.committedAt,
          },
          $setOnInsert: {
            userId,
            provider,
            repositoryExternalId: item.repositoryExternalId,
            externalId: item.externalId,
          },
        },
        upsert: true,
      },
    })),
  );

export const persistIssues = (
  userId: Id,
  provider: string,
  items: readonly IssueRecord[],
): Promise<PersistResult> =>
  runBulk(
    IssueModel as unknown as BulkWritable,
    items.map((item) => ({
      updateOne: {
        filter: { userId, provider, externalId: item.externalId },
        update: {
          $set: {
            repositoryExternalId: item.repositoryExternalId,
            repositoryFullName: item.repositoryFullName,
            number: item.number,
            title: item.title,
            state: item.state,
            authorLogin: item.authorLogin,
            labels: item.labels,
            comments: item.comments,
            url: item.url,
            remoteCreatedAt: item.createdAt,
            remoteUpdatedAt: item.updatedAt,
            closedAt: item.closedAt,
          },
          $setOnInsert: { userId, provider, externalId: item.externalId },
        },
        upsert: true,
      },
    })),
  );

export const persistPullRequests = (
  userId: Id,
  provider: string,
  items: readonly PullRequestRecord[],
): Promise<PersistResult> =>
  runBulk(
    PullRequestModel as unknown as BulkWritable,
    items.map((item) => ({
      updateOne: {
        filter: { userId, provider, externalId: item.externalId },
        update: {
          $set: {
            repositoryExternalId: item.repositoryExternalId,
            repositoryFullName: item.repositoryFullName,
            number: item.number,
            title: item.title,
            state: item.state,
            isDraft: item.isDraft,
            authorLogin: item.authorLogin,
            labels: item.labels,
            headRef: item.headRef,
            baseRef: item.baseRef,
            url: item.url,
            remoteCreatedAt: item.createdAt,
            remoteUpdatedAt: item.updatedAt,
            closedAt: item.closedAt,
            mergedAt: item.mergedAt,
          },
          $setOnInsert: { userId, provider, externalId: item.externalId },
        },
        upsert: true,
      },
    })),
  );

/** Removes everything synced for a user, used when an integration is revoked. */
export const purgeSyncedData = async (userId: Id): Promise<void> => {
  await Promise.all([
    RepositoryModel.deleteMany({ userId }),
    CommitModel.deleteMany({ userId }),
    IssueModel.deleteMany({ userId }),
    PullRequestModel.deleteMany({ userId }),
  ]);
};

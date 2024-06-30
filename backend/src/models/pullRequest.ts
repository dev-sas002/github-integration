import mongoose, { Document, Schema } from 'mongoose';

export interface IPullRequest extends Document {
  userId: mongoose.Types.ObjectId;
  provider: string;
  externalId: string;
  repositoryExternalId: string;
  repositoryFullName: string;
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  isDraft: boolean;
  authorLogin: string | null;
  labels: string[];
  headRef: string | null;
  baseRef: string | null;
  url: string | null;
  remoteCreatedAt: Date | null;
  remoteUpdatedAt: Date | null;
  closedAt: Date | null;
  mergedAt: Date | null;
}

const PullRequestSchema: Schema = new Schema(
  {
    userId: { type: mongoose.Types.ObjectId, required: true, ref: 'User' },
    provider: { type: String, required: true, default: 'github' },
    externalId: { type: String, required: true },
    repositoryExternalId: { type: String, required: true },
    repositoryFullName: { type: String, required: true },
    number: { type: Number, required: true },
    title: { type: String, default: '' },
    state: { type: String, enum: ['open', 'closed', 'merged'], default: 'open' },
    isDraft: { type: Boolean, default: false },
    authorLogin: { type: String, default: null },
    labels: { type: [String], default: [] },
    headRef: { type: String, default: null },
    baseRef: { type: String, default: null },
    url: { type: String, default: null },
    remoteCreatedAt: { type: Date, default: null },
    remoteUpdatedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    mergedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

PullRequestSchema.index({ userId: 1, provider: 1, externalId: 1 }, { unique: true });
// The stale-PR detector reads exactly this: open PRs ordered by last touch.
PullRequestSchema.index({ userId: 1, state: 1, remoteUpdatedAt: 1 });
PullRequestSchema.index({ userId: 1, repositoryExternalId: 1, remoteUpdatedAt: -1 });

export default mongoose.model<IPullRequest>('PullRequest', PullRequestSchema);

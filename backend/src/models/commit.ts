import mongoose, { Document, Schema } from 'mongoose';

export interface ICommit extends Document {
  userId: mongoose.Types.ObjectId;
  provider: string;
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

const CommitSchema: Schema = new Schema(
  {
    userId: { type: mongoose.Types.ObjectId, required: true, ref: 'User' },
    provider: { type: String, required: true, default: 'github' },
    externalId: { type: String, required: true },
    repositoryExternalId: { type: String, required: true },
    repositoryFullName: { type: String, required: true },
    message: { type: String, default: '' },
    authorName: { type: String, default: null },
    authorLogin: { type: String, default: null },
    authorEmail: { type: String, default: null },
    url: { type: String, default: null },
    committedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// A commit SHA is unique per repository, not globally (forks share SHAs).
CommitSchema.index(
  { userId: 1, provider: 1, repositoryExternalId: 1, externalId: 1 },
  { unique: true },
);
// Backs the activity timeline and the "commits per day" aggregation.
CommitSchema.index({ userId: 1, committedAt: -1 });
CommitSchema.index({ userId: 1, repositoryExternalId: 1, committedAt: -1 });

export default mongoose.model<ICommit>('Commit', CommitSchema);

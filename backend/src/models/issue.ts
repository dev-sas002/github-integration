import mongoose, { Document, Schema } from 'mongoose';

export interface IIssue extends Document {
  userId: mongoose.Types.ObjectId;
  provider: string;
  externalId: string;
  repositoryExternalId: string;
  repositoryFullName: string;
  number: number;
  title: string;
  state: 'open' | 'closed';
  authorLogin: string | null;
  labels: string[];
  comments: number;
  url: string | null;
  remoteCreatedAt: Date | null;
  remoteUpdatedAt: Date | null;
  closedAt: Date | null;
}

const IssueSchema: Schema = new Schema(
  {
    userId: { type: mongoose.Types.ObjectId, required: true, ref: 'User' },
    provider: { type: String, required: true, default: 'github' },
    externalId: { type: String, required: true },
    repositoryExternalId: { type: String, required: true },
    repositoryFullName: { type: String, required: true },
    number: { type: Number, required: true },
    title: { type: String, default: '' },
    state: { type: String, enum: ['open', 'closed'], default: 'open' },
    authorLogin: { type: String, default: null },
    labels: { type: [String], default: [] },
    comments: { type: Number, default: 0 },
    url: { type: String, default: null },
    remoteCreatedAt: { type: Date, default: null },
    remoteUpdatedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

IssueSchema.index({ userId: 1, provider: 1, externalId: 1 }, { unique: true });
IssueSchema.index({ userId: 1, state: 1, remoteUpdatedAt: -1 });
IssueSchema.index({ userId: 1, repositoryExternalId: 1, remoteUpdatedAt: -1 });

export default mongoose.model<IIssue>('Issue', IssueSchema);

import mongoose, { Document, Schema } from 'mongoose';

export interface IRepository extends Document {
  userId: mongoose.Types.ObjectId;
  provider: string;
  externalId: string;
  name: string;
  fullName: string;
  owner: string;
  description: string | null;
  url: string | null;
  defaultBranch: string;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  language: string | null;
  topics: string[];
  stars: number;
  forks: number;
  openIssues: number;
  sizeKb: number;
  pushedAt: Date | null;
  remoteCreatedAt: Date | null;
  remoteUpdatedAt: Date | null;
  syncedAt: Date;
}

const RepositorySchema: Schema = new Schema(
  {
    userId: { type: mongoose.Types.ObjectId, required: true, ref: 'User' },
    provider: { type: String, required: true, default: 'github' },
    externalId: { type: String, required: true },
    name: { type: String, required: true },
    fullName: { type: String, required: true },
    owner: { type: String, required: true },
    description: { type: String, default: null },
    url: { type: String, default: null },
    defaultBranch: { type: String, default: 'main' },
    isPrivate: { type: Boolean, default: false },
    isFork: { type: Boolean, default: false },
    isArchived: { type: Boolean, default: false },
    language: { type: String, default: null },
    topics: { type: [String], default: [] },
    stars: { type: Number, default: 0 },
    forks: { type: Number, default: 0 },
    openIssues: { type: Number, default: 0 },
    sizeKb: { type: Number, default: 0 },
    pushedAt: { type: Date, default: null },
    remoteCreatedAt: { type: Date, default: null },
    remoteUpdatedAt: { type: Date, default: null },
    syncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// Identity of a synced record: the upsert key for every sync run.
RepositorySchema.index({ userId: 1, provider: 1, externalId: 1 }, { unique: true });
// Backs the default listing (most recently pushed first) without an in-memory sort.
RepositorySchema.index({ userId: 1, provider: 1, pushedAt: -1 });
// Backs `?language=` and `?q=` filtering on the repositories endpoint.
RepositorySchema.index({ userId: 1, language: 1 });
RepositorySchema.index({ userId: 1, fullName: 1 });

export default mongoose.model<IRepository>('Repository', RepositorySchema);

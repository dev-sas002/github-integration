import mongoose, { Document, Schema } from 'mongoose';
import { ResourceKind } from '../domain/types';

export type SyncStatus = 'ok' | 'partial' | 'not_modified' | 'error' | 'rate_limited';

export interface ISyncState extends Document {
  userId: mongoose.Types.ObjectId;
  provider: string;
  resource: ResourceKind;
  /** Empty for account-wide resources; the repository id for per-repo ones. */
  scopeId: string;
  /** `If-None-Match` validator for the first page of this listing. */
  etag: string | null;
  /** Watermark handed to the provider as `since` on the next run. */
  lastSyncedAt: Date | null;
  /** `rel="next"` URL a truncated walk stopped at; the next run starts there. */
  resumeCursor: string | null;
  /** Watermark to adopt once a resumed walk reaches the end of the listing. */
  pendingWatermark: Date | null;
  lastStatus: SyncStatus;
  lastError: string | null;
  recordCount: number;
}

const SyncStateSchema: Schema = new Schema(
  {
    userId: { type: mongoose.Types.ObjectId, required: true, ref: 'User' },
    provider: { type: String, required: true, default: 'github' },
    resource: { type: String, required: true },
    /**
     * Deliberately not `required`: the account-wide resources use the empty
     * string as their scope, and mongoose's `required` validator rejects ''.
     * Identity is enforced by the unique compound index below instead.
     */
    scopeId: { type: String, default: '' },
    etag: { type: String, default: null },
    lastSyncedAt: { type: Date, default: null },
    resumeCursor: { type: String, default: null },
    pendingWatermark: { type: Date, default: null },
    lastStatus: {
      type: String,
      enum: ['ok', 'partial', 'not_modified', 'error', 'rate_limited'],
      default: 'ok',
    },
    lastError: { type: String, default: null },
    recordCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// This document *is* the resume point of the pipeline, so its key has to be
// exactly the thing the pipeline resumes by.
SyncStateSchema.index({ userId: 1, provider: 1, resource: 1, scopeId: 1 }, { unique: true });

export default mongoose.model<ISyncState>('SyncState', SyncStateSchema);

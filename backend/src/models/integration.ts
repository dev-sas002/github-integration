import mongoose, { Document, Schema } from 'mongoose';

export interface IIntegration extends Document {
  userId: mongoose.Types.ObjectId;
  provider: string;
  connectedAt: Date;
  accountLogin?: string;
  accountAvatarUrl?: string;
  accountProfileUrl?: string;
}

const IntegrationSchema: Schema = new Schema(
  {
    userId: { type: mongoose.Types.ObjectId, required: true, ref: 'User' },
    provider: { type: String, required: true },
    connectedAt: { type: Date, required: true },
    // Denormalised from the provider account so the UI header does not need a
    // second upstream call on every page load.
    accountLogin: { type: String },
    accountAvatarUrl: { type: String },
    accountProfileUrl: { type: String },
  },
  { timestamps: true },
);

// A user has at most one live integration per provider; the unique index is
// what makes the reconnect upsert safe under concurrent callbacks.
IntegrationSchema.index({ userId: 1, provider: 1 }, { unique: true });

export default mongoose.model<IIntegration>('Integration', IntegrationSchema);

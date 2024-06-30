import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
  username: string;
  githubId: string;
  accessToken: string;
}

const UserSchema: Schema = new Schema(
  {
    username: { type: String, required: true },
    // One local account per GitHub account: reconnecting must update, not clone.
    githubId: { type: String, required: true, unique: true, index: true },
    // The access token is the API's bearer credential, so every authenticated
    // request looks a user up by it. Without this index that is a collection
    // scan on the hottest path in the service.
    accessToken: { type: String, index: true },
  },
  { timestamps: true },
);

export default mongoose.model<IUser>('User', UserSchema);

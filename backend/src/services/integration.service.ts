import appConfig from '../config/appConfig';
import { SourceProvider } from '../domain/provider';
import { getProvider } from '../domain/registry';
import { ProviderAccount } from '../domain/types';
import { badRequest, notFound, serviceUnavailable } from '../lib/httpError';
import logger from '../lib/logger';
import IntegrationModel from '../models/integration';
import SyncStateModel from '../models/syncState';
import UserModel from '../models/user';
import { consumeOAuthState, createOAuthState } from '../helpers/oauthState';
import { purgeSyncedData } from './syncPersistence';

/** The `githubId` the seed script writes for the fabricated demo account. */
export const DEMO_GITHUB_ID = 'demo-1';

/** Where the SPA expects to be dropped back after the OAuth round trip. */
export const frontendReturnUrl = `${appConfig.frontendUrl}/github-integration`;

const provider = (providerId: string): SourceProvider => {
  const found = getProvider(providerId);

  if (!found.isConfigured()) {
    throw serviceUnavailable(
      `${found.displayName} is not configured on this deployment. Set its client id and secret to enable the connect flow.`,
    );
  }

  return found;
};

/**
 * Starts the OAuth dance.
 *
 * A single-use `state` is issued here and verified in the callback; without it
 * an attacker can bind a victim's session to their own account.
 */
export const buildAuthorizationUrl = (providerId = 'github'): string =>
  provider(providerId).buildAuthorizationUrl({
    state: createOAuthState(),
    redirectUri: appConfig.githubRedirectUri,
  });

export interface CallbackResult {
  redirectUrl: string;
}

const linkAccount = async (account: ProviderAccount, token: string, providerName: string) => {
  let user = await UserModel.findOne({ githubId: account.externalId });

  if (!user) {
    user = new UserModel({
      username: account.username,
      githubId: account.externalId,
      accessToken: token,
    });
  } else {
    // Keep the latest access token (and username) in sync so future calls use
    // the freshest credentials.
    user.username = account.username;
    user.accessToken = token;
  }

  await user.save();

  // Upsert rather than insert: reconnecting previously created a duplicate
  // Integration document on every callback.
  await IntegrationModel.findOneAndUpdate(
    { userId: user._id, provider: providerName },
    {
      connectedAt: new Date(),
      accountLogin: account.username,
      accountAvatarUrl: account.avatarUrl,
      accountProfileUrl: account.profileUrl,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return user;
};

/**
 * Completes the OAuth callback: validates state, exchanges the code, links the
 * account and hands the SPA back its token.
 *
 * Failures redirect rather than render: an OAuth callback is a browser
 * navigation, and leaking upstream error text into it helps nobody.
 */
export const completeAuthorization = async (
  code: unknown,
  state: unknown,
  providerId = 'github',
): Promise<CallbackResult> => {
  if (!code || typeof code !== 'string') {
    throw badRequest('Missing or invalid GitHub OAuth code');
  }

  if (!consumeOAuthState(state)) {
    // Unknown/expired/replayed state: the callback did not originate from a
    // flow this server started, so the code must not be exchanged.
    throw badRequest('Invalid or expired OAuth state');
  }

  const source = provider(providerId);
  const token = await source.exchangeCodeForToken({
    code,
    redirectUri: appConfig.githubRedirectUri,
  });

  const account = await source.getAuthenticatedAccount(token);
  await linkAccount(account, token, source.displayName);

  return {
    redirectUrl: `${frontendReturnUrl}?token=${encodeURIComponent(token)}`,
  };
};

export interface IntegrationStatus {
  isConnected: boolean;
  connectionDate: Date | null;
}

export const getIntegrationStatus = async (userId: string): Promise<IntegrationStatus> => {
  const integration = await IntegrationModel.findOne({ userId });

  return {
    isConnected: Boolean(integration),
    connectionDate: integration?.connectedAt ?? null,
  };
};

/**
 * Revokes the remote token, then removes every local trace of the account.
 *
 * Remote revocation happens first: if it fails for a reason other than "the
 * token is already gone", local state is left alone so the caller can retry
 * rather than being stranded with a live token nobody tracks.
 */
export const disconnect = async (
  userId: string,
  token: string,
  providerId = 'github',
): Promise<void> => {
  const source = getProvider(providerId);

  if (source.isConfigured()) {
    await source.revokeToken(token);
  } else {
    logger.warn('provider not configured; skipping remote token revocation', {
      provider: providerId,
    });
  }

  // deleteMany clears any duplicate integrations created before the callback
  // started upserting.
  await IntegrationModel.deleteMany({ userId });
  await SyncStateModel.deleteMany({ userId });
  await purgeSyncedData(userId);
  await UserModel.findOneAndDelete({ _id: userId });
};

export interface DemoSession {
  token: string;
  username: string;
}

/**
 * Hands back the seeded demo account's credentials.
 *
 * Only reachable when `DEMO_MODE=true`; otherwise it is a 404, which is what
 * a caller would see if the route did not exist at all.
 */
export const getDemoSession = async (): Promise<DemoSession> => {
  if (!appConfig.demoMode) {
    throw notFound('Not found');
  }

  const user = await UserModel.findOne({ githubId: DEMO_GITHUB_ID });

  if (!user) {
    throw notFound('No demo account has been seeded. Run the seed command first.');
  }

  return { token: String(user.accessToken), username: String(user.username) };
};

export interface ProviderSummary {
  id: string;
  displayName: string;
  configured: boolean;
}

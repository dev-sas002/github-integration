import { Request, Response } from 'express';
import { listProviders } from '../domain/registry';
import logger from '../lib/logger';
import { ProviderError } from '../domain/provider';
import {
  buildAuthorizationUrl,
  completeAuthorization,
  disconnect,
  frontendReturnUrl,
  getIntegrationStatus,
} from '../services/integration.service';

/**
 * HTTP adapters for the OAuth flow.
 *
 * Each handler does three things and nothing else: read the request, call one
 * service function, shape the response. Every rule these used to carry — state
 * validation, token exchange, upserts, revocation ordering — now lives in
 * `services/integration.service.ts` where it can be tested without Express.
 */

export const initiateGitHubOAuth = (_req: Request, res: Response): void => {
  res.redirect(buildAuthorizationUrl());
};

export const handleGitHubOAuthCallback = async (req: Request, res: Response): Promise<void> => {
  const { code, state } = req.query;

  // Validation failures answer with JSON; only failures *after* a valid
  // handshake redirect, because by then a browser is mid-navigation.
  const result = await completeAuthorization(code, state).catch((error: unknown) => {
    if (error instanceof ProviderError || !(error as { status?: number })?.status) {
      logger.error('GitHub OAuth failed', { message: (error as Error).message });
      const reason =
        error instanceof ProviderError && error.rateLimited ? 'rate_limited' : 'oauth_failed';
      res.redirect(`${frontendReturnUrl}?error=${reason}`);
      return null;
    }
    throw error;
  });

  if (result) {
    res.redirect(result.redirectUrl);
  }
};

export const checkStatus = async (req: Request, res: Response): Promise<void> => {
  const status = await getIntegrationStatus(req.auth!.id);

  res.json({
    isConnected: status.isConnected,
    connectionDate: status.connectionDate ?? null,
    username: req.auth!.username || null,
  });
};

export const removeIntegration = async (req: Request, res: Response): Promise<void> => {
  await disconnect(req.auth!.id, req.auth!.token);
  res.json({ isConnected: false });
};

/** Lists the configured source providers — the registry, rendered. */
export const listConfiguredProviders = (_req: Request, res: Response): void => {
  res.json({
    providers: listProviders().map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      configured: provider.isConfigured(),
    })),
  });
};

import { Router } from 'express';
import {
  checkStatus,
  handleGitHubOAuthCallback,
  initiateGitHubOAuth,
  listConfiguredProviders,
  removeIntegration,
} from '../controllers/github.controller';
import { authenticate } from '../http/middleware/authenticate';

const router = Router();

router.get('/providers', listConfiguredProviders);
router.get('/connect', initiateGitHubOAuth);
router.get('/callback', handleGitHubOAuthCallback);

router.get(
  '/status',
  // The SPA polls this before it has a token, so an unauthenticated answer
  // still has to carry `isConnected: false` rather than a bare message.
  authenticate({ extra: { isConnected: false } }),
  checkStatus,
);

router.delete(
  '/remove',
  authenticate({
    invalidStatus: 404,
    invalidMessage: 'GitHub integration not found for user',
  }),
  removeIntegration,
);

export default router;

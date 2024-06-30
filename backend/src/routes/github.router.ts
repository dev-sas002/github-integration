import { Router } from 'express';
import expressAsyncHandler from 'express-async-handler';
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
router.get('/connect', expressAsyncHandler(initiateGitHubOAuth));
router.get('/callback', expressAsyncHandler(handleGitHubOAuthCallback));

router.get(
  '/status',
  // The SPA polls this before it has a token, so an unauthenticated answer
  // still has to carry `isConnected: false` rather than a bare message.
  authenticate({ extra: { isConnected: false } }),
  expressAsyncHandler(checkStatus),
);

router.delete(
  '/remove',
  authenticate({
    invalidStatus: 404,
    invalidMessage: 'GitHub integration not found for user',
  }),
  expressAsyncHandler(removeIntegration),
);

export default router;

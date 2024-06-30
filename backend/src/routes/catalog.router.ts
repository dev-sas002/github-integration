import { Router } from 'express';
import expressAsyncHandler from 'express-async-handler';
import {
  getCommits,
  getDashboardOverview,
  getIssues,
  getPullRequests,
  getRepositories,
} from '../http/controllers/catalog.controller';
import { authenticate } from '../http/middleware/authenticate';

const router = Router();

router.use(authenticate());

router.get('/overview', expressAsyncHandler(getDashboardOverview));
router.get('/repositories', expressAsyncHandler(getRepositories));
router.get('/commits', expressAsyncHandler(getCommits));
router.get('/issues', expressAsyncHandler(getIssues));
router.get('/pull-requests', expressAsyncHandler(getPullRequests));

export default router;

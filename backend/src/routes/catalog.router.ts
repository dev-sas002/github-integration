import { Router } from 'express';
import {
  getCommits,
  getDashboardOverview,
  getIssues,
  getPullRequests,
  getRepositories,
  getRepositoryLanguages,
} from '../http/controllers/catalog.controller';
import { authenticate } from '../http/middleware/authenticate';

const router = Router();

router.use(authenticate());

router.get('/overview', getDashboardOverview);
router.get('/repositories', getRepositories);
router.get('/languages', getRepositoryLanguages);
router.get('/commits', getCommits);
router.get('/issues', getIssues);
router.get('/pull-requests', getPullRequests);

export default router;

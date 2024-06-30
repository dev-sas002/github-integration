import { Router } from 'express';
import { getRepositorySummary, getStalePrs } from '../http/controllers/insights.controller';
import { authenticate } from '../http/middleware/authenticate';

const router = Router();

router.use(authenticate());

router.get('/stale-pull-requests', getStalePrs);
router.get('/repositories/:repositoryId', getRepositorySummary);

export default router;

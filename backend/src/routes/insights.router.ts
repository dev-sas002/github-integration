import { Router } from 'express';
import expressAsyncHandler from 'express-async-handler';
import { getRepositorySummary, getStalePrs } from '../http/controllers/insights.controller';
import { authenticate } from '../http/middleware/authenticate';

const router = Router();

router.use(authenticate());

router.get('/stale-pull-requests', expressAsyncHandler(getStalePrs));
router.get('/repositories/:repositoryId', expressAsyncHandler(getRepositorySummary));

export default router;

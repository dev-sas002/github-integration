import { Router } from 'express';
import { readSyncState, triggerSync } from '../http/controllers/sync.controller';
import { authenticate } from '../http/middleware/authenticate';

const router = Router();

router.use(authenticate());

router.post('/', triggerSync);
router.get('/state', readSyncState);

export default router;

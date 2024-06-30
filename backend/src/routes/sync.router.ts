import { Router } from 'express';
import expressAsyncHandler from 'express-async-handler';
import { readSyncState, triggerSync } from '../http/controllers/sync.controller';
import { authenticate } from '../http/middleware/authenticate';

const router = Router();

router.use(authenticate());

router.post('/', expressAsyncHandler(triggerSync));
router.get('/state', expressAsyncHandler(readSyncState));

export default router;

import { Router } from 'express';
import expressAsyncHandler from 'express-async-handler';
import { getDemoSession } from '../services/integration.service';

const router = Router();

/**
 * Demo-only. Returns the seeded account's token so the dashboard can be
 * opened with no GitHub OAuth app. 404s unless `DEMO_MODE=true`.
 */
router.get(
  '/session',
  expressAsyncHandler(async (_req, res) => {
    res.json(await getDemoSession());
  }),
);

export default router;

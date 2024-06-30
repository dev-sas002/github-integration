import { Request, Response } from 'express';
import { getSyncState } from '../../services/catalog.service';
import { runSync } from '../../services/sync.service';

/**
 * Triggers a sync for the authenticated user and returns the run report.
 *
 * The run is bounded (page cap, repository cap, rate-limit floor) and
 * single-flighted per user, so a held-down button costs one run, not ten.
 */
export const triggerSync = async (req: Request, res: Response): Promise<void> => {
  const full = req.query.mode === 'full';
  const repositoryLimit = Number(req.query.repositories) || undefined;

  const report = await runSync(req.auth!.id, req.auth!.token, { full, repositoryLimit });

  // A throttled repository listing means nothing at all was synced, so the
  // caller is told to back off rather than handed a 200 with a warning.
  const listing = report.results.find((result) => result.resource === 'repositories');
  if (listing?.status === 'rate_limited') {
    if (listing.retryAfterSeconds) {
      res.set('Retry-After', String(listing.retryAfterSeconds));
    }
    res.status(429).json(report);
    return;
  }

  res.json(report);
};

/** The pipeline's resume points: one row per resource the sync walks. */
export const readSyncState = async (req: Request, res: Response): Promise<void> => {
  res.json({ states: await getSyncState(req.auth!.id) });
};

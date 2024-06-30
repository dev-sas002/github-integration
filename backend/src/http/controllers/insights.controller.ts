import { Request, Response } from 'express';
import appConfig from '../../config/appConfig';
import { getRepositoryInsight, getStalePullRequests } from '../../services/insights.service';

/** Rule-based: no key required, no upstream call. */
export const getStalePrs = async (req: Request, res: Response): Promise<void> => {
  const limit = Number(req.query.limit) || 20;

  res.json({
    thresholdDays: appConfig.stalePullRequestDays,
    items: await getStalePullRequests(req.auth!.id, limit),
  });
};

/**
 * Narrative summary for one repository. `source` in the response says whether
 * the prose came from the model or from the local fallback.
 */
export const getRepositorySummary = async (req: Request, res: Response): Promise<void> => {
  res.json(
    await getRepositoryInsight(req.auth!.id, req.params.repositoryId, {
      refresh: req.query.refresh === 'true',
    }),
  );
};

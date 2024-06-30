import { Request, Response } from 'express';
import {
  getOverview,
  listCommits,
  listIssues,
  listPullRequests,
  listRepositories,
  listRepositoryLanguages,
} from '../../services/catalog.service';

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/** Read side of the API. Every list endpoint is paged and every page is capped. */
export const getRepositories = async (req: Request, res: Response): Promise<void> => {
  res.json(
    await listRepositories(req.auth!.id, {
      page: Number(req.query.page) || undefined,
      limit: Number(req.query.limit) || undefined,
      q: str(req.query.q),
      language: str(req.query.language),
      sort: str(req.query.sort) as 'pushed' | 'stars' | 'name' | undefined,
    }),
  );
};

export const getRepositoryLanguages = async (req: Request, res: Response): Promise<void> => {
  res.json({ languages: await listRepositoryLanguages(req.auth!.id) });
};

export const getCommits = async (req: Request, res: Response): Promise<void> => {
  res.json(
    await listCommits(req.auth!.id, {
      page: Number(req.query.page) || undefined,
      limit: Number(req.query.limit) || undefined,
      repositoryId: str(req.query.repositoryId),
      author: str(req.query.author),
    }),
  );
};

export const getIssues = async (req: Request, res: Response): Promise<void> => {
  res.json(
    await listIssues(req.auth!.id, {
      page: Number(req.query.page) || undefined,
      limit: Number(req.query.limit) || undefined,
      repositoryId: str(req.query.repositoryId),
      state: str(req.query.state) as 'open' | 'closed' | undefined,
    }),
  );
};

export const getPullRequests = async (req: Request, res: Response): Promise<void> => {
  res.json(
    await listPullRequests(req.auth!.id, {
      page: Number(req.query.page) || undefined,
      limit: Number(req.query.limit) || undefined,
      repositoryId: str(req.query.repositoryId),
      state: str(req.query.state) as 'open' | 'closed' | 'merged' | undefined,
    }),
  );
};

export const getDashboardOverview = async (req: Request, res: Response): Promise<void> => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  res.json(await getOverview(req.auth!.id, days));
};

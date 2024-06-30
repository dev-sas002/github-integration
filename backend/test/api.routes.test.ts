import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';

/**
 * Router-level tests for the read, sync and insight surfaces.
 *
 * The services are doubles: what is under test here is the HTTP contract —
 * the shared authentication guard, query-parameter coercion, and the fact
 * that a thrown provider error becomes the right status.
 */
const mocks = vi.hoisted(() => {
  const UserModel = { findOne: vi.fn() };

  const catalog = {
    listRepositories: vi.fn(async () => ({ items: [], page: 1, limit: 25, total: 0 })),
    listCommits: vi.fn(async () => ({ items: [] })),
    listIssues: vi.fn(async () => ({ items: [] })),
    listPullRequests: vi.fn(async () => ({ items: [] })),
    getOverview: vi.fn(async () => ({ counts: {} })),
    getSyncState: vi.fn(async () => []),
  };

  const sync = { runSync: vi.fn(async () => ({ provider: 'github', mode: 'incremental' })) };

  const insights = {
    getStalePullRequests: vi.fn(async () => []),
    getRepositoryInsight: vi.fn(async () => ({ repository: 'octo-labs/x', source: 'heuristic' })),
  };

  return { UserModel, catalog, sync, insights };
});

vi.mock('../src/models/user', () => ({ default: mocks.UserModel }));
vi.mock('../src/services/catalog.service', () => mocks.catalog);
vi.mock('../src/services/sync.service', () => mocks.sync);
vi.mock('../src/services/insights.service', () => mocks.insights);

import catalogRoutes from '../src/routes/catalog.router';
import insightsRoutes from '../src/routes/insights.router';
import syncRoutes from '../src/routes/sync.router';
import { ProviderError } from '../src/domain/provider';
import { errorHandler } from '../src/http/middleware/errorHandler';

const TOKEN = 'Bearer demo-token';

const buildApp = (): Express => {
  const app = express();
  app.use(express.json());
  app.use('/api/catalog', catalogRoutes);
  app.use('/api/sync', syncRoutes);
  app.use('/api/insights', insightsRoutes);
  app.use(errorHandler);
  return app;
};

let app: Express;

beforeEach(() => {
  app = buildApp();
  mocks.UserModel.findOne.mockResolvedValue({ _id: 'user-1', username: 'octo' });
  mocks.sync.runSync.mockResolvedValue({ provider: 'github', mode: 'incremental' });
});

describe('authentication guard', () => {
  const protectedRoutes: Array<[string, string]> = [
    ['get', '/api/catalog/overview'],
    ['get', '/api/catalog/repositories'],
    ['get', '/api/sync/state'],
    ['post', '/api/sync'],
    ['get', '/api/insights/stale-pull-requests'],
  ];

  it.each(protectedRoutes)('401s %s %s without a token', async (method, path) => {
    const response = await (request(app) as any)[method](path);
    expect(response.status).toBe(401);
  });

  it('401s when the token matches no user', async () => {
    mocks.UserModel.findOne.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/catalog/repositories')
      .set('Authorization', TOKEN);

    expect(response.status).toBe(401);
  });

  it('looks the user up by the exact stored header value', async () => {
    await request(app).get('/api/catalog/repositories').set('Authorization', TOKEN);

    expect(mocks.UserModel.findOne).toHaveBeenCalledWith({ accessToken: TOKEN });
  });
});

describe('catalog routes', () => {
  it('passes paging and filters through to the service', async () => {
    await request(app)
      .get('/api/catalog/repositories?page=3&limit=10&q=ledger&language=Go&sort=stars')
      .set('Authorization', TOKEN);

    expect(mocks.catalog.listRepositories).toHaveBeenCalledWith('user-1', {
      page: 3,
      limit: 10,
      q: 'ledger',
      language: 'Go',
      sort: 'stars',
    });
  });

  it('leaves paging undefined when the client sends none, so defaults apply', async () => {
    await request(app).get('/api/catalog/commits').set('Authorization', TOKEN);

    expect(mocks.catalog.listCommits).toHaveBeenCalledWith('user-1', {
      page: undefined,
      limit: undefined,
      repositoryId: undefined,
      author: undefined,
    });
  });

  it('filters issues by repository and state', async () => {
    await request(app)
      .get('/api/catalog/issues?repositoryId=r1&state=closed')
      .set('Authorization', TOKEN);

    expect(mocks.catalog.listIssues).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ repositoryId: 'r1', state: 'closed' }),
    );
  });

  it('clamps the overview window to a year', async () => {
    await request(app).get('/api/catalog/overview?days=99999').set('Authorization', TOKEN);

    expect(mocks.catalog.getOverview).toHaveBeenCalledWith('user-1', 365);
  });

  it('falls back to a 30 day window for a nonsense value', async () => {
    await request(app).get('/api/catalog/overview?days=abc').set('Authorization', TOKEN);

    expect(mocks.catalog.getOverview).toHaveBeenCalledWith('user-1', 30);
  });
});

describe('sync routes', () => {
  it('runs an incremental sync by default', async () => {
    const response = await request(app).post('/api/sync').set('Authorization', TOKEN);

    expect(response.status).toBe(200);
    expect(mocks.sync.runSync).toHaveBeenCalledWith('user-1', TOKEN, {
      full: false,
      repositoryLimit: undefined,
    });
  });

  it('honours an explicit full resync and a repository cap', async () => {
    await request(app).post('/api/sync?mode=full&repositories=2').set('Authorization', TOKEN);

    expect(mocks.sync.runSync).toHaveBeenCalledWith('user-1', TOKEN, {
      full: true,
      repositoryLimit: 2,
    });
  });

  it('answers 429 with Retry-After when GitHub rate limits the run', async () => {
    mocks.sync.runSync.mockRejectedValue(
      new ProviderError('limited', { rateLimited: true, retryAfterSeconds: 42, status: 403 }),
    );

    const response = await request(app).post('/api/sync').set('Authorization', TOKEN);

    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBe('42');
  });

  it('answers 502 for a non rate-limit provider failure', async () => {
    mocks.sync.runSync.mockRejectedValue(new ProviderError('boom', { status: 500 }));

    const response = await request(app).post('/api/sync').set('Authorization', TOKEN);

    expect(response.status).toBe(502);
  });

  it('exposes the pipeline resume points', async () => {
    const response = await request(app).get('/api/sync/state').set('Authorization', TOKEN);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ states: [] });
  });
});

describe('insight routes', () => {
  it('reports the threshold alongside the stale list', async () => {
    const response = await request(app)
      .get('/api/insights/stale-pull-requests')
      .set('Authorization', TOKEN);

    expect(response.status).toBe(200);
    expect(response.body.thresholdDays).toBeGreaterThan(0);
  });

  it('passes the repository id and refresh flag through', async () => {
    await request(app)
      .get('/api/insights/repositories/repo-1?refresh=true')
      .set('Authorization', TOKEN);

    expect(mocks.insights.getRepositoryInsight).toHaveBeenCalledWith('user-1', 'repo-1', {
      refresh: true,
    });
  });

  it('treats a missing refresh flag as a cached read', async () => {
    await request(app).get('/api/insights/repositories/repo-1').set('Authorization', TOKEN);

    expect(mocks.insights.getRepositoryInsight).toHaveBeenCalledWith('user-1', 'repo-1', {
      refresh: false,
    });
  });
});

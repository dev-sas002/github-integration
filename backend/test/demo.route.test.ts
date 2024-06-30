import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';

/**
 * `DEMO_MODE` is read once, when `appConfig` is first imported, so the flag has
 * to be set before the module graph loads — hence `vi.hoisted`. The disabled
 * case re-imports the graph with the flag off.
 */
const mocks = vi.hoisted(() => {
  process.env.DEMO_MODE = 'true';
  const stub = () => ({ deleteMany: vi.fn(), findOneAndUpdate: vi.fn() });
  return { UserModel: { findOne: vi.fn() }, stub };
});

// Every model the integration service pulls in is a double, so re-importing
// the graph never re-registers a mongoose schema.
vi.mock('../src/models/user', () => ({ default: mocks.UserModel }));
vi.mock('../src/models/integration', () => ({ default: mocks.stub() }));
vi.mock('../src/models/syncState', () => ({ default: mocks.stub() }));
vi.mock('../src/models/repository', () => ({ default: mocks.stub() }));
vi.mock('../src/models/commit', () => ({ default: mocks.stub() }));
vi.mock('../src/models/issue', () => ({ default: mocks.stub() }));
vi.mock('../src/models/pullRequest', () => ({ default: mocks.stub() }));

import demoRoutes from '../src/routes/demo.router';
import { errorHandler } from '../src/http/middleware/errorHandler';

const buildApp = (router: express.Router): Express => {
  const app = express();
  app.use('/api/demo', router);
  app.use(errorHandler);
  return app;
};

beforeEach(() => {
  mocks.UserModel.findOne.mockReset();
});

describe('GET /api/demo/session', () => {
  it('returns the seeded account credentials when demo mode is on', async () => {
    mocks.UserModel.findOne.mockResolvedValue({
      accessToken: 'Bearer demo-token',
      username: 'octo-labs-demo',
    });

    const response = await request(buildApp(demoRoutes)).get('/api/demo/session');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ token: 'Bearer demo-token', username: 'octo-labs-demo' });
  });

  it('looks the account up by the seed script’s githubId', async () => {
    mocks.UserModel.findOne.mockResolvedValue({ accessToken: 't', username: 'u' });

    await request(buildApp(demoRoutes)).get('/api/demo/session');

    expect(mocks.UserModel.findOne).toHaveBeenCalledWith({ githubId: 'demo-1' });
  });

  it('404s when nothing has been seeded yet', async () => {
    mocks.UserModel.findOne.mockResolvedValue(null);

    const response = await request(buildApp(demoRoutes)).get('/api/demo/session');

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('seed');
  });

  it('404s — as though the route did not exist — when demo mode is off', async () => {
    process.env.DEMO_MODE = 'false';
    vi.resetModules();

    const [{ default: router }, { errorHandler: handler }] = await Promise.all([
      import('../src/routes/demo.router'),
      import('../src/http/middleware/errorHandler'),
    ]);

    const app = express();
    app.use('/api/demo', router);
    app.use(handler);

    const response = await request(app).get('/api/demo/session');

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Not found');
    process.env.DEMO_MODE = 'true';
  });
});

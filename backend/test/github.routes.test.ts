import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';

/**
 * Router-level tests for the GitHub integration endpoints.
 *
 * Every outbound HTTP call is mocked at the axios module boundary and both
 * mongoose models are replaced with in-memory doubles, so the suite never
 * touches the network or a database.
 */
const mocks = vi.hoisted(() => {
  const axios = {
    post: vi.fn(),
    // Every GitHub REST call goes through `axios.request` (the client uses it
    // rather than an axios instance precisely so it can be mocked here).
    request: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    isAxiosError: (error: any) => Boolean(error && error.isAxiosError),
  };

  const savedUsers: any[] = [];
  const UserModel: any = vi.fn(function (this: any, doc: any) {
    Object.assign(this, doc);
    this._id = 'new-user-id';
    this.save = vi.fn(async () => {
      savedUsers.push(this);
      return this;
    });
  });
  UserModel.findOne = vi.fn();
  UserModel.findOneAndDelete = vi.fn(async () => null);

  const IntegrationModel = {
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(async () => ({})),
    deleteMany: vi.fn(async () => ({ deletedCount: 1 })),
  };

  // Disconnecting also purges everything that was synced for the user, so the
  // read models have to be doubles too or the suite would reach for a database.
  const collection = () => ({
    deleteMany: vi.fn(async () => ({ deletedCount: 0 })),
  });

  const RepositoryModel = collection();
  const CommitModel = collection();
  const IssueModel = collection();
  const PullRequestModel = collection();
  const SyncStateModel = collection();

  return {
    axios,
    UserModel,
    IntegrationModel,
    RepositoryModel,
    CommitModel,
    IssueModel,
    PullRequestModel,
    SyncStateModel,
    savedUsers,
  };
});

vi.mock('axios', () => ({ default: mocks.axios }));
vi.mock('../src/models/user', () => ({ default: mocks.UserModel }));
vi.mock('../src/models/integration', () => ({ default: mocks.IntegrationModel }));
vi.mock('../src/models/repository', () => ({ default: mocks.RepositoryModel }));
vi.mock('../src/models/commit', () => ({ default: mocks.CommitModel }));
vi.mock('../src/models/issue', () => ({ default: mocks.IssueModel }));
vi.mock('../src/models/pullRequest', () => ({ default: mocks.PullRequestModel }));
vi.mock('../src/models/syncState', () => ({ default: mocks.SyncStateModel }));

import '../src/providers';
import githubRoutes from '../src/routes/github.router';
import appConfig from '../src/config/appConfig';
import { errorHandler } from '../src/http/middleware/errorHandler';
import { createOAuthState, resetOAuthStates } from '../src/helpers/oauthState';

const FRONTEND_RETURN = 'http://localhost:4200/connection';

const buildApp = (): Express => {
  const app = express();
  app.use(express.json());
  app.use('/api/github', githubRoutes);
  // Controllers throw; this is the one place an error becomes a response, so
  // the suite has to mount it exactly as the real application does.
  app.use(errorHandler);
  return app;
};

const axiosError = (status: number, headers: Record<string, string> = {}) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, headers, data: {} },
  });

/** A resolved `axios.request` result in the shape the GitHub client expects. */
const githubResponse = (data: unknown, headers: Record<string, string> = {}, status = 200) => ({
  status,
  data,
  headers,
});

/** Finds the single `axios.request` config matching a predicate. */
const requestConfig = (predicate: (config: any) => boolean) => {
  const call = mocks.axios.request.mock.calls.find(([config]: any[]) => predicate(config));
  if (!call) {
    throw new Error('no matching axios.request call was made');
  }
  return call[0];
};

let app: Express;

beforeEach(() => {
  app = buildApp();
  resetOAuthStates();
  mocks.savedUsers.length = 0;
  mocks.axios.post.mockReset();
  mocks.axios.request.mockReset();
  mocks.axios.get.mockReset();
  mocks.axios.delete.mockReset();
  for (const model of [
    mocks.RepositoryModel,
    mocks.CommitModel,
    mocks.IssueModel,
    mocks.PullRequestModel,
    mocks.SyncStateModel,
  ]) {
    model.deleteMany.mockReset().mockResolvedValue({ deletedCount: 0 });
  }
  mocks.UserModel.mockClear();
  mocks.UserModel.findOne.mockReset();
  mocks.UserModel.findOneAndDelete.mockReset().mockResolvedValue(null);
  mocks.IntegrationModel.findOne.mockReset();
  mocks.IntegrationModel.findOneAndUpdate.mockReset().mockResolvedValue({});
  mocks.IntegrationModel.deleteMany.mockReset().mockResolvedValue({ deletedCount: 1 });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('GET /api/github/connect', () => {
  it('redirects to GitHub with the configured client id, redirect uri and scopes', async () => {
    const res = await request(app).get('/api/github/connect');

    expect(res.status).toBe(302);
    const url = new URL(res.headers.location);
    expect(`${url.origin}${url.pathname}`).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe(appConfig.githubClientId);
    expect(url.searchParams.get('redirect_uri')).toBe(appConfig.githubRedirectUri);
    expect(url.searchParams.get('scope')).toBe('repo,user');
  });

  it('issues a fresh anti-CSRF state on every call', async () => {
    const first = new URL((await request(app).get('/api/github/connect')).headers.location);
    const second = new URL((await request(app).get('/api/github/connect')).headers.location);

    const stateA = first.searchParams.get('state');
    const stateB = second.searchParams.get('state');

    expect(stateA).toMatch(/^[0-9a-f]{64}$/);
    expect(stateB).not.toBe(stateA);
  });

  it('never makes an outbound call of its own', async () => {
    await request(app).get('/api/github/connect');
    expect(mocks.axios.post).not.toHaveBeenCalled();
    expect(mocks.axios.request).not.toHaveBeenCalled();
  });
});

describe('GET /api/github/callback', () => {
  const okExchange = () =>
    mocks.axios.post.mockResolvedValue({ data: { access_token: 'gho_token' } });
  const okUser = () =>
    mocks.axios.request.mockResolvedValue(githubResponse({ id: 4242, login: 'octocat' }));

  it('rejects a callback with no code', async () => {
    const res = await request(app).get('/api/github/callback');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Missing or invalid GitHub OAuth code/);
    expect(mocks.axios.post).not.toHaveBeenCalled();
  });

  it('rejects a forged callback whose state was never issued (OAuth CSRF)', async () => {
    const res = await request(app).get('/api/github/callback?code=abc&state=deadbeef');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid or expired OAuth state/);
    // The attacker-supplied code must never be exchanged.
    expect(mocks.axios.post).not.toHaveBeenCalled();
  });

  it('rejects a callback with no state at all', async () => {
    const res = await request(app).get('/api/github/callback?code=abc');

    expect(res.status).toBe(400);
    expect(mocks.axios.post).not.toHaveBeenCalled();
  });

  it('rejects a replayed state', async () => {
    okExchange();
    okUser();
    mocks.UserModel.findOne.mockResolvedValue(null);
    const state = createOAuthState();

    const first = await request(app).get(`/api/github/callback?code=abc&state=${state}`);
    expect(first.status).toBe(302);

    const replay = await request(app).get(`/api/github/callback?code=abc&state=${state}`);
    expect(replay.status).toBe(400);
  });

  it('creates the user and the integration, then redirects back to the SPA with the token', async () => {
    okExchange();
    okUser();
    mocks.UserModel.findOne.mockResolvedValue(null);
    const state = createOAuthState();

    const res = await request(app).get(`/api/github/callback?code=abc&state=${state}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      `${FRONTEND_RETURN}#token=${encodeURIComponent('Bearer gho_token')}&username=octocat`,
    );

    expect(mocks.UserModel).toHaveBeenCalledWith({
      username: 'octocat',
      githubId: '4242',
      accessToken: 'Bearer gho_token',
    });
    expect(mocks.savedUsers).toHaveLength(1);

    expect(mocks.IntegrationModel.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: 'new-user-id', provider: 'GitHub' },
      {
        connectedAt: expect.any(Date),
        accountLogin: 'octocat',
        accountAvatarUrl: null,
        accountProfileUrl: null,
      },
      expect.objectContaining({ upsert: true }),
    );
  });

  it('upserts rather than inserting a second integration for a returning user', async () => {
    okExchange();
    okUser();
    const existing = {
      _id: 'existing-id',
      username: 'old',
      accessToken: 'Bearer old',
      save: vi.fn(),
    };
    mocks.UserModel.findOne.mockResolvedValue(existing);

    await request(app).get(`/api/github/callback?code=abc&state=${createOAuthState()}`);

    expect(mocks.UserModel).not.toHaveBeenCalled();
    expect(existing.accessToken).toBe('Bearer gho_token');
    expect(existing.username).toBe('octocat');
    expect(existing.save).toHaveBeenCalledTimes(1);
    expect(mocks.IntegrationModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('calls the GitHub user API with the bearer token, versioned Accept header and a timeout', async () => {
    okExchange();
    okUser();
    mocks.UserModel.findOne.mockResolvedValue(null);

    await request(app).get(`/api/github/callback?code=abc&state=${createOAuthState()}`);

    const config = requestConfig((candidate) => String(candidate.url).endsWith('/user'));
    expect(config.url).toBe(`${appConfig.githubApiBaseUrl}/user`);
    expect(config.method).toBe('GET');
    expect(config.headers.Authorization).toBe('Bearer gho_token');
    expect(config.headers.Accept).toBe('application/vnd.github+json');
    expect(config.headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect(config.timeout).toBe(appConfig.githubRequestTimeoutMs);
  });

  it('redirects with a generic error when the code exchange fails', async () => {
    mocks.axios.post.mockResolvedValue({ data: { error: 'bad_verification_code' } });

    const res = await request(app).get(`/api/github/callback?code=abc&state=${createOAuthState()}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${FRONTEND_RETURN}?error=oauth_failed`);
    // No internal detail is leaked to the browser.
    expect(res.headers.location).not.toMatch(/bad_verification_code/);
    expect(mocks.IntegrationModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('redirects with a rate_limited hint when GitHub returns 403 with no quota left', async () => {
    okExchange();
    mocks.axios.request.mockRejectedValue(axiosError(403, { 'x-ratelimit-remaining': '0' }));

    const res = await request(app).get(`/api/github/callback?code=abc&state=${createOAuthState()}`);

    expect(res.headers.location).toBe(`${FRONTEND_RETURN}?error=rate_limited`);
  });

  it('treats a 403 with quota remaining as a plain failure, not a rate limit', async () => {
    okExchange();
    mocks.axios.request.mockRejectedValue(axiosError(403, { 'x-ratelimit-remaining': '17' }));

    const res = await request(app).get(`/api/github/callback?code=abc&state=${createOAuthState()}`);

    expect(res.headers.location).toBe(`${FRONTEND_RETURN}?error=oauth_failed`);
  });

  it('does not persist anything when the user payload is missing id/login', async () => {
    okExchange();
    mocks.axios.request.mockResolvedValue(githubResponse({}));

    const res = await request(app).get(`/api/github/callback?code=abc&state=${createOAuthState()}`);

    expect(res.headers.location).toBe(`${FRONTEND_RETURN}?error=oauth_failed`);
    expect(mocks.savedUsers).toHaveLength(0);
    expect(mocks.IntegrationModel.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('GET /api/github/status', () => {
  it('401s without an Authorization header', async () => {
    const res = await request(app).get('/api/github/status');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ isConnected: false });
    expect(mocks.UserModel.findOne).not.toHaveBeenCalled();
  });

  it('401s for a token that matches no user', async () => {
    mocks.UserModel.findOne.mockResolvedValue(null);

    const res = await request(app).get('/api/github/status').set('Authorization', 'Bearer nope');

    expect(res.status).toBe(401);
    expect(res.body.isConnected).toBe(false);
  });

  it('reports the connection and its date for a connected user', async () => {
    const connectedAt = new Date('2024-05-01T10:00:00.000Z');
    mocks.UserModel.findOne.mockResolvedValue({ _id: 'u1', username: 'octocat' });
    mocks.IntegrationModel.findOne.mockResolvedValue({ connectedAt });

    const res = await request(app)
      .get('/api/github/status')
      .set('Authorization', 'Bearer gho_token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      isConnected: true,
      connectionDate: connectedAt.toISOString(),
      username: 'octocat',
    });
  });

  it('reports not connected when the user has no integration document', async () => {
    mocks.UserModel.findOne.mockResolvedValue({ _id: 'u1' });
    mocks.IntegrationModel.findOne.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/github/status')
      .set('Authorization', 'Bearer gho_token');

    expect(res.body).toEqual({ isConnected: false, connectionDate: null, username: null });
  });

  it('URL-decodes the Authorization header before the lookup', async () => {
    mocks.UserModel.findOne.mockResolvedValue({ _id: 'u1' });
    mocks.IntegrationModel.findOne.mockResolvedValue(null);

    await request(app).get('/api/github/status').set('Authorization', 'Bearer%20gho_token');

    expect(mocks.UserModel.findOne).toHaveBeenCalledWith({
      accessToken: 'Bearer gho_token',
    });
  });

  it('does not blow up on a malformed percent-encoded header', async () => {
    mocks.UserModel.findOne.mockResolvedValue(null);

    const res = await request(app).get('/api/github/status').set('Authorization', 'Bearer 100%');

    expect(res.status).toBe(401);
    expect(mocks.UserModel.findOne).toHaveBeenCalledWith({ accessToken: 'Bearer 100%' });
  });
});

describe('DELETE /api/github/remove', () => {
  const connectedUser = () => mocks.UserModel.findOne.mockResolvedValue({ _id: 'u1' });

  it('401s without an Authorization header', async () => {
    const res = await request(app).delete('/api/github/remove');

    expect(res.status).toBe(401);
    expect(mocks.axios.request).not.toHaveBeenCalled();
  });

  it('404s when the token matches no user', async () => {
    mocks.UserModel.findOne.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/github/remove')
      .set('Authorization', 'Bearer unknown');

    expect(res.status).toBe(404);
    expect(mocks.axios.request).not.toHaveBeenCalled();
  });

  it('revokes the token at GitHub with basic auth and clears local state', async () => {
    connectedUser();
    mocks.axios.request.mockResolvedValue(githubResponse({}, {}, 204));

    const res = await request(app)
      .delete('/api/github/remove')
      .set('Authorization', 'Bearer gho_token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isConnected: false });

    const config = requestConfig((candidate) => candidate.method === 'DELETE');
    expect(config.url).toBe(
      `${appConfig.githubApiBaseUrl}/applications/${appConfig.githubClientId}/token`,
    );
    expect(config.data).toEqual({ access_token: 'gho_token' });
    expect(config.timeout).toBe(appConfig.githubRequestTimeoutMs);

    const expectedBasic = Buffer.from(
      `${appConfig.githubClientId}:${appConfig.githubClientSecret}`,
    ).toString('base64');
    expect(config.headers.Authorization).toBe(`Basic ${expectedBasic}`);

    expect(mocks.IntegrationModel.deleteMany).toHaveBeenCalledWith({ userId: 'u1' });
    expect(mocks.UserModel.findOneAndDelete).toHaveBeenCalledWith({ _id: 'u1' });
  });

  it('still cleans up locally when GitHub says the token is already gone', async () => {
    connectedUser();
    mocks.axios.request.mockRejectedValue(axiosError(404));

    const res = await request(app)
      .delete('/api/github/remove')
      .set('Authorization', 'Bearer gho_token');

    expect(res.status).toBe(200);
    expect(mocks.IntegrationModel.deleteMany).toHaveBeenCalled();
    expect(mocks.UserModel.findOneAndDelete).toHaveBeenCalled();
  });

  it('502s and keeps local state when revocation fails for another reason', async () => {
    connectedUser();
    mocks.axios.request.mockRejectedValue(axiosError(500));

    const res = await request(app)
      .delete('/api/github/remove')
      .set('Authorization', 'Bearer gho_token');

    expect(res.status).toBe(502);
    expect(mocks.IntegrationModel.deleteMany).not.toHaveBeenCalled();
    expect(mocks.UserModel.findOneAndDelete).not.toHaveBeenCalled();
  });

  it('429s with Retry-After when the GitHub rate limit is hit', async () => {
    connectedUser();
    mocks.axios.request.mockRejectedValue(axiosError(429, { 'retry-after': '60' }));

    const res = await request(app)
      .delete('/api/github/remove')
      .set('Authorization', 'Bearer gho_token');

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('60');
    expect(mocks.IntegrationModel.deleteMany).not.toHaveBeenCalled();
  });

  it('derives Retry-After from x-ratelimit-reset when no Retry-After header is sent', async () => {
    connectedUser();
    const resetAt = Math.floor(Date.now() / 1000) + 120;
    mocks.axios.request.mockRejectedValue(
      axiosError(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetAt) }),
    );

    const res = await request(app)
      .delete('/api/github/remove')
      .set('Authorization', 'Bearer gho_token');

    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(100);
  });

  it('sends the raw token (not the Bearer prefix) to the revocation endpoint', async () => {
    connectedUser();
    mocks.axios.request.mockResolvedValue(githubResponse({}, {}, 204));

    await request(app).delete('/api/github/remove').set('Authorization', 'Bearer%20gho_token');

    expect(requestConfig((candidate) => candidate.method === 'DELETE').data).toEqual({
      access_token: 'gho_token',
    });
  });
});

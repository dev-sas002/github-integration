import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * appConfig validates the environment at import time, so each case has to
 * reset the module registry and re-import it with a tailored environment.
 */
const REQUIRED = {
  DB_URL: 'mongodb://localhost:27017/x',
  GITHUB_API_URL: 'https://github.com/login/oauth/access_token',
  GITHUB_CLIENT_ID: 'id',
  GITHUB_CLIENT_SECRET: 'secret',
};

const ALL_KEYS = [
  'SERVER_PORT',
  'SEREVR_PORT',
  'DB_URL',
  'GITHUB_API_URL',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_API_BASE_URL',
  'GITHUB_REDIRECT_URI',
  'GITHUB_SCOPES',
  'GITHUB_REQUEST_TIMEOUT_MS',
  'FRONTEND_URL',
  'CORS_ORIGINS',
];

const original: Record<string, string | undefined> = {};

const loadConfig = async (env: Record<string, string>) => {
  for (const key of ALL_KEYS) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
  vi.resetModules();
  return (await import('../src/config/appConfig')).default;
};

beforeEach(() => {
  for (const key of ALL_KEYS) {
    original[key] = process.env[key];
  }
});

afterEach(() => {
  for (const key of ALL_KEYS) {
    if (original[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original[key] as string;
    }
  }
  vi.resetModules();
});

describe('appConfig', () => {
  it('throws when a required variable is missing', async () => {
    await expect(loadConfig({ SERVER_PORT: '3000' })).rejects.toThrow(
      /Missing required environment variable/,
    );
  });

  it('accepts the legacy misspelled SEREVR_PORT', async () => {
    const config = await loadConfig({ ...REQUIRED, SEREVR_PORT: '4321' });
    expect(config.serverPort).toBe(4321);
  });

  it('prefers SERVER_PORT over the legacy name', async () => {
    const config = await loadConfig({ ...REQUIRED, SERVER_PORT: '5000', SEREVR_PORT: '4321' });
    expect(config.serverPort).toBe(5000);
  });

  it('falls back to port 3000 for a non-numeric value', async () => {
    const config = await loadConfig({ ...REQUIRED, SERVER_PORT: 'not-a-port' });
    expect(config.serverPort).toBe(3000);
  });

  it('supplies sane defaults for the optional settings', async () => {
    const config = await loadConfig({ ...REQUIRED, SERVER_PORT: '3000' });

    expect(config.githubApiBaseUrl).toBe('https://api.github.com');
    expect(config.githubRedirectUri).toBe('http://localhost:3000/api/github/callback');
    expect(config.githubScopes).toBe('repo,user');
    expect(config.githubRequestTimeoutMs).toBe(10000);
    expect(config.frontendUrl).toBe('http://localhost:4200');
    expect(config.corsOrigins).toEqual(['http://localhost:4200']);
  });

  it('strips trailing slashes so redirect URLs never double up', async () => {
    const config = await loadConfig({
      ...REQUIRED,
      SERVER_PORT: '3000',
      FRONTEND_URL: 'https://app.example.com/',
      GITHUB_API_BASE_URL: 'https://ghe.example.com/api/v3/',
    });

    expect(config.frontendUrl).toBe('https://app.example.com');
    expect(config.githubApiBaseUrl).toBe('https://ghe.example.com/api/v3');
  });

  it('defaults the CORS whitelist to the frontend URL and parses a list', async () => {
    const single = await loadConfig({
      ...REQUIRED,
      SERVER_PORT: '3000',
      FRONTEND_URL: 'https://app.example.com',
    });
    expect(single.corsOrigins).toEqual(['https://app.example.com']);

    const many = await loadConfig({
      ...REQUIRED,
      SERVER_PORT: '3000',
      CORS_ORIGINS: 'https://a.example.com, https://b.example.com/ ,',
    });
    expect(many.corsOrigins).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('ignores a non-positive timeout and keeps the default', async () => {
    const config = await loadConfig({
      ...REQUIRED,
      SERVER_PORT: '3000',
      GITHUB_REQUEST_TIMEOUT_MS: '0',
    });
    expect(config.githubRequestTimeoutMs).toBe(10000);
  });
});

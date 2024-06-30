import dotenv from 'dotenv';

dotenv.config();

/**
 * Centralised, validated application configuration.
 *
 * Everything the process needs is read and checked once, at import time, so a
 * misconfigured deployment fails on boot with a clear message rather than at
 * the first request. Only `DB_URL` is genuinely required: the service is
 * designed to start and serve read traffic with no GitHub credentials at all,
 * which is what makes the demo seed and the test suite runnable offline.
 */
const resolveEnv = (keys: string[]): string => {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim().length > 0) {
      return value;
    }
  }

  throw new Error(`Missing required environment variable. Tried keys: ${keys.join(', ')}`);
};

/** Same lookup as `resolveEnv`, but falls back to a default instead of throwing. */
const optionalEnv = (keys: string[], fallback: string): string => {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }

  return fallback;
};

const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const parsePositiveInt = (value: string, fallback: number): number => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseBoundedInt = (value: string, fallback: number, min: number, max: number): number => {
  const parsed = parsePositiveInt(value, fallback);
  return Math.min(Math.max(parsed, min), max);
};

const frontendUrl = stripTrailingSlash(optionalEnv(['FRONTEND_URL'], 'http://localhost:4200'));

const githubClientId = optionalEnv(['GITHUB_CLIENT_ID'], '');
const githubClientSecret = optionalEnv(['GITHUB_CLIENT_SECRET'], '');
const anthropicApiKey = optionalEnv(['ANTHROPIC_API_KEY'], '');

const appConfig = {
  serverPort: parsePositiveInt(resolveEnv(['SERVER_PORT', 'SEREVR_PORT']), 3000),
  dbUrl: resolveEnv(['DB_URL']),

  // --- GitHub OAuth app ---------------------------------------------------
  githubApiUrl: optionalEnv(['GITHUB_API_URL'], 'https://github.com/login/oauth/access_token'),
  githubAuthorizeUrl: optionalEnv(
    ['GITHUB_AUTHORIZE_URL'],
    'https://github.com/login/oauth/authorize',
  ),
  githubClientId,
  githubClientSecret,
  /**
   * False when no OAuth app is configured. The API still boots; the OAuth
   * endpoints answer 503 instead of redirecting users into a broken flow.
   */
  githubConfigured: githubClientId.length > 0 && githubClientSecret.length > 0,
  githubApiBaseUrl: stripTrailingSlash(
    optionalEnv(['GITHUB_API_BASE_URL'], 'https://api.github.com'),
  ),
  githubRedirectUri: optionalEnv(
    ['GITHUB_REDIRECT_URI'],
    'http://localhost:3000/api/github/callback',
  ),
  githubScopes: optionalEnv(['GITHUB_SCOPES'], 'repo,user'),
  githubRequestTimeoutMs: parsePositiveInt(
    optionalEnv(['GITHUB_REQUEST_TIMEOUT_MS'], '10000'),
    10000,
  ),

  // --- Sync pipeline ------------------------------------------------------
  /** Items requested per upstream page. GitHub caps `per_page` at 100. */
  syncPageSize: parseBoundedInt(optionalEnv(['SYNC_PAGE_SIZE'], '100'), 100, 1, 100),
  /** Hard stop on pages walked per resource, so one huge account cannot run forever. */
  syncMaxPages: parseBoundedInt(optionalEnv(['SYNC_MAX_PAGES'], '20'), 20, 1, 1000),
  /** Repositories whose children are fetched in parallel during one sync run. */
  syncConcurrency: parseBoundedInt(optionalEnv(['SYNC_CONCURRENCY'], '4'), 4, 1, 16),
  /** Attempts (including the first) for a retryable upstream failure. */
  syncMaxRetries: parseBoundedInt(optionalEnv(['SYNC_MAX_RETRIES'], '4'), 4, 1, 10),
  /** Base delay for the exponential backoff between retries. */
  syncRetryBaseMs: parsePositiveInt(optionalEnv(['SYNC_RETRY_BASE_MS'], '500'), 500),
  /**
   * Stop making new upstream calls once the remaining hourly quota drops below
   * this, leaving headroom for interactive traffic such as OAuth callbacks.
   */
  syncRateLimitFloor: parseBoundedInt(optionalEnv(['SYNC_RATE_LIMIT_FLOOR'], '50'), 50, 0, 5000),

  // --- Read API -----------------------------------------------------------
  defaultPageSize: parseBoundedInt(optionalEnv(['API_DEFAULT_PAGE_SIZE'], '25'), 25, 1, 100),
  maxPageSize: parseBoundedInt(optionalEnv(['API_MAX_PAGE_SIZE'], '100'), 100, 1, 500),

  // --- Insights / AI ------------------------------------------------------
  anthropicApiKey,
  anthropicModel: optionalEnv(['ANTHROPIC_MODEL'], 'claude-opus-5'),
  anthropicBaseUrl: stripTrailingSlash(
    optionalEnv(['ANTHROPIC_BASE_URL'], 'https://api.anthropic.com'),
  ),
  anthropicTimeoutMs: parsePositiveInt(optionalEnv(['ANTHROPIC_TIMEOUT_MS'], '20000'), 20000),
  /** With no key the insights endpoints fall back to deterministic heuristics. */
  aiEnabled: anthropicApiKey.length > 0,
  /** A pull request with no update for this many days is reported as stale. */
  stalePullRequestDays: parseBoundedInt(optionalEnv(['STALE_PR_DAYS'], '14'), 14, 1, 365),

  /**
   * Demo mode. When true, `GET /api/demo/session` hands out the seeded demo
   * account's token so `docker compose up` lands on a populated dashboard
   * with nothing to configure. It is an authentication bypass over fabricated
   * seed data and must never be enabled on a real deployment — hence the
   * explicit opt-in and the warning logged at boot.
   */
  demoMode: optionalEnv(['DEMO_MODE'], 'false').toLowerCase() === 'true',

  frontendUrl,
  /** Origin(s) the browser app is served from; used for the CORS whitelist. */
  corsOrigins: optionalEnv(['CORS_ORIGINS'], frontendUrl)
    .split(',')
    .map((origin) => stripTrailingSlash(origin.trim()))
    .filter((origin) => origin.length > 0),
  logLevel: optionalEnv(['LOG_LEVEL'], 'info'),
  nodeEnv: optionalEnv(['NODE_ENV'], 'development'),
};

export type AppConfig = typeof appConfig;

export default appConfig;

/**
 * Deterministic environment for the test run.
 *
 * `src/config/appConfig.ts` validates its environment at import time, so these
 * values have to exist before any module under test is loaded. dotenv never
 * overwrites variables that are already set, so a developer's real `.env`
 * cannot leak into (or break) the suite.
 *
 * Two deliberate choices: there is no `ANTHROPIC_API_KEY`, so the AI paths run
 * their heuristic fallback and no test can make a paid call; and retries are
 * pinned to a single attempt so no test ever sleeps through a backoff. The
 * backoff itself is covered directly in `test/backoff.test.ts` with an
 * injected clock.
 */
process.env.SERVER_PORT = '3000';
process.env.DB_URL = 'mongodb://localhost:27017/integrations-test';
process.env.GITHUB_API_URL = 'https://github.com/login/oauth/access_token';
process.env.GITHUB_CLIENT_ID = 'test-client-id';
process.env.GITHUB_CLIENT_SECRET = 'test-client-secret';
process.env.GITHUB_API_BASE_URL = 'https://api.github.com';
process.env.GITHUB_REDIRECT_URI = 'http://localhost:3000/api/github/callback';
process.env.FRONTEND_URL = 'http://localhost:4200';
process.env.GITHUB_SCOPES = 'repo,user';
process.env.GITHUB_REQUEST_TIMEOUT_MS = '10000';
process.env.SYNC_MAX_RETRIES = '1';
process.env.SYNC_PAGE_SIZE = '100';
process.env.SYNC_MAX_PAGES = '5';
process.env.SYNC_CONCURRENCY = '2';
process.env.STALE_PR_DAYS = '14';
// Keep the suite's output readable: only errors reach stdout.
process.env.LOG_LEVEL = 'error';
delete process.env.ANTHROPIC_API_KEY;

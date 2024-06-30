import {
  CommitRecord,
  IssueRecord,
  PageRequest,
  ProviderAccount,
  ProviderId,
  ProviderPage,
  PullRequestRecord,
  RepositoryRecord,
  RepositoryScope,
} from './types';

/**
 * The seam.
 *
 * Every remote source of repository data implements this interface, and the
 * sync pipeline is written entirely against it — it never imports anything
 * from `providers/github`. Adding GitLab means writing one class here and
 * registering it; no service, model, controller or component changes.
 */
export interface SourceProvider {
  readonly id: ProviderId | string;

  /** Human-readable name, surfaced in the UI and in sync reports. */
  readonly displayName: string;

  /** False when the deployment has no credentials for this provider. */
  isConfigured(): boolean;

  /** Builds the URL the browser is sent to in order to authorise the app. */
  buildAuthorizationUrl(input: { state: string; redirectUri: string }): string;

  /** Exchanges the short-lived authorisation code for an access token. */
  exchangeCodeForToken(input: { code: string; redirectUri: string }): Promise<string>;

  /** Identifies the account the token belongs to. */
  getAuthenticatedAccount(token: string): Promise<ProviderAccount>;

  /** Best-effort remote revocation. Resolves even when the token is already gone. */
  revokeToken(token: string): Promise<void>;

  listRepositories(token: string, page: PageRequest): Promise<ProviderPage<RepositoryRecord>>;

  listCommits(
    token: string,
    repo: RepositoryScope,
    page: PageRequest,
  ): Promise<ProviderPage<CommitRecord>>;

  listIssues(
    token: string,
    repo: RepositoryScope,
    page: PageRequest,
  ): Promise<ProviderPage<IssueRecord>>;

  listPullRequests(
    token: string,
    repo: RepositoryScope,
    page: PageRequest,
  ): Promise<ProviderPage<PullRequestRecord>>;
}

/** Raised by a provider when the upstream refuses a call. */
export class ProviderError extends Error {
  readonly status: number | null;

  readonly retryable: boolean;

  readonly rateLimited: boolean;

  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    options: {
      status?: number | null;
      retryable?: boolean;
      rateLimited?: boolean;
      retryAfterSeconds?: number | null;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
    this.rateLimited = options.rateLimited ?? false;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

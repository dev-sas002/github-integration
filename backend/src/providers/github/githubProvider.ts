import appConfig from '../../config/appConfig';
import { ProviderError, SourceProvider } from '../../domain/provider';
import {
  CommitRecord,
  IssueRecord,
  PageRequest,
  ProviderAccount,
  ProviderPage,
  PullRequestRecord,
  RepositoryRecord,
  RepositoryScope,
} from '../../domain/types';
import { getGitHubOAuthToken } from '../../helpers/oauthHelper';
import { GitHubClient, GitHubResponse } from './githubClient';
import {
  isPullRequestPayload,
  mapAccount,
  mapCommit,
  mapIssue,
  mapPullRequest,
  mapRepository,
} from './mappers';

/** Strips the `Bearer ` prefix the app stores tokens with. */
export const rawToken = (token: string): string => {
  const parts = token.split(' ');
  return parts.length === 2 ? parts[1] : token;
};

const clampPageSize = (pageSize: number | undefined): number =>
  Math.min(Math.max(pageSize ?? appConfig.syncPageSize, 1), 100);

/**
 * GitHub implementation of the `SourceProvider` seam.
 *
 * Responsibilities stop at "talk to api.github.com and hand back neutral
 * records". It owns no persistence, no scheduling and no business rules —
 * those belong to the sync service, which never imports this file directly.
 */
export class GitHubProvider implements SourceProvider {
  readonly id = 'github';

  readonly displayName = 'GitHub';

  constructor(private readonly client: GitHubClient = new GitHubClient()) {}

  isConfigured(): boolean {
    return appConfig.githubConfigured;
  }

  buildAuthorizationUrl({ state, redirectUri }: { state: string; redirectUri: string }): string {
    const params = new URLSearchParams({
      client_id: appConfig.githubClientId,
      redirect_uri: redirectUri,
      scope: appConfig.githubScopes,
      state,
    });

    return `${appConfig.githubAuthorizeUrl}?${params.toString()}`;
  }

  async exchangeCodeForToken({
    code,
    redirectUri,
  }: {
    code: string;
    redirectUri: string;
  }): Promise<string> {
    return getGitHubOAuthToken(code, redirectUri);
  }

  async getAuthenticatedAccount(token: string): Promise<ProviderAccount> {
    const response = await this.client.request<Record<string, unknown>>({
      url: '/user',
      token,
    });

    const account = mapAccount(response.data ?? {});

    if (!account.externalId || !account.username) {
      throw new ProviderError('GitHub user response did not include id/login');
    }

    return account;
  }

  async revokeToken(token: string): Promise<void> {
    const basic = Buffer.from(
      `${appConfig.githubClientId}:${appConfig.githubClientSecret}`,
    ).toString('base64');

    try {
      await this.client.request({
        url: `/applications/${appConfig.githubClientId}/token`,
        method: 'DELETE',
        headers: { Authorization: `Basic ${basic}` },
        data: { access_token: rawToken(token) },
      });
    } catch (error) {
      // GitHub answers 401/404 when it has already forgotten the token. That is
      // the desired end state, so it resolves rather than stranding the caller
      // in a permanently "connected" state.
      if (error instanceof ProviderError && (error.status === 401 || error.status === 404)) {
        return;
      }
      throw error;
    }
  }

  async listRepositories(
    token: string,
    page: PageRequest,
  ): Promise<ProviderPage<RepositoryRecord>> {
    const response = await this.fetchPage<Record<string, any>[]>(token, page, {
      url: '/user/repos',
      params: {
        per_page: clampPageSize(page.pageSize),
        sort: 'pushed',
        direction: 'desc',
        affiliation: 'owner,collaborator,organization_member',
      },
    });

    return this.toPage(response, (items) => items.map(mapRepository));
  }

  async listCommits(
    token: string,
    repo: RepositoryScope,
    page: PageRequest,
  ): Promise<ProviderPage<CommitRecord>> {
    const emptyRepository: ProviderPage<CommitRecord> = {
      items: [],
      nextCursor: null,
      etag: null,
      notModified: false,
      rateLimit: null,
    };

    let response: GitHubResponse<Record<string, any>[]>;

    try {
      response = await this.fetchPage<Record<string, any>[]>(token, page, {
        url: `/repos/${repo.owner}/${repo.name}/commits`,
        params: {
          per_page: clampPageSize(page.pageSize),
          // The incremental watermark: GitHub filters server-side so an
          // unchanged repository costs one empty page, not a history walk.
          since: page.since ? page.since.toISOString() : undefined,
        },
        // A repository with no commits at all answers 409, which is a fact
        // about the repository rather than a failure.
        allowStatuses: [409],
      });
    } catch (error) {
      if (error instanceof ProviderError && error.status === 409) {
        return emptyRepository;
      }
      throw error;
    }

    if (response.status === 409) {
      return { ...emptyRepository, etag: response.etag, rateLimit: response.rateLimit };
    }

    return this.toPage(response, (items) =>
      items.map((item) => mapCommit(item, repo.externalId, repo.fullName)),
    );
  }

  async listIssues(
    token: string,
    repo: RepositoryScope,
    page: PageRequest,
  ): Promise<ProviderPage<IssueRecord>> {
    const response = await this.fetchPage<Record<string, any>[]>(token, page, {
      url: `/repos/${repo.owner}/${repo.name}/issues`,
      params: {
        per_page: clampPageSize(page.pageSize),
        state: 'all',
        sort: 'updated',
        direction: 'desc',
        since: page.since ? page.since.toISOString() : undefined,
      },
    });

    return this.toPage(response, (items) =>
      items
        .filter((item) => !isPullRequestPayload(item))
        .map((item) => mapIssue(item, repo.externalId, repo.fullName)),
    );
  }

  async listPullRequests(
    token: string,
    repo: RepositoryScope,
    page: PageRequest,
  ): Promise<ProviderPage<PullRequestRecord>> {
    const response = await this.fetchPage<Record<string, any>[]>(token, page, {
      url: `/repos/${repo.owner}/${repo.name}/pulls`,
      params: {
        per_page: clampPageSize(page.pageSize),
        state: 'all',
        sort: 'updated',
        direction: 'desc',
      },
    });

    // `/pulls` has no `since` filter, so the watermark is applied client-side.
    // The listing is sorted by `updated` descending, which is what lets the
    // pipeline stop walking as soon as it sees an older record.
    return this.toPage(response, (items) =>
      items
        .map((item) => mapPullRequest(item, repo.externalId, repo.fullName))
        .filter((pr) => !page.since || !pr.updatedAt || pr.updatedAt > page.since),
    );
  }

  /**
   * One page fetch: follows an opaque cursor when there is one, otherwise
   * builds the first request and attaches the stored ETag.
   */
  private fetchPage<T>(
    token: string,
    page: PageRequest,
    request: {
      url: string;
      params?: Record<string, string | number | undefined>;
      allowStatuses?: number[];
    },
  ): Promise<GitHubResponse<T>> {
    const followingCursor = Boolean(page.cursor);

    return this.client.request<T>({
      // The cursor is the `rel="next"` URL GitHub handed back, so page 2+
      // carries its own query string and must not be rebuilt.
      url: followingCursor ? (page.cursor as string) : request.url,
      token,
      params: followingCursor ? undefined : request.params,
      // A validator only means anything for the first page of a listing.
      etag: followingCursor ? null : (page.etag ?? null),
      allowStatuses: request.allowStatuses,
    });
  }

  private toPage<TRaw, TOut>(
    response: GitHubResponse<TRaw[]>,
    map: (items: TRaw[]) => TOut[],
  ): ProviderPage<TOut> {
    if (response.notModified) {
      return {
        items: [],
        nextCursor: null,
        etag: response.etag,
        notModified: true,
        rateLimit: response.rateLimit,
      };
    }

    return {
      items: map(Array.isArray(response.data) ? response.data : []),
      nextCursor: response.nextUrl,
      etag: response.etag,
      notModified: false,
      rateLimit: response.rateLimit,
    };
  }
}

export default GitHubProvider;

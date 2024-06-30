import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  Commit,
  DemoSession,
  Issue,
  Overview,
  Paginated,
  ProviderSummary,
  PullRequest,
  Repository,
  RepositoryInsight,
  StalePullRequestResponse,
  SyncReport,
  SyncStateRow,
} from './api.types';

/** Drops undefined/empty values so the query string carries only real filters. */
const toParams = (values: Record<string, string | number | undefined | null>): HttpParams => {
  let params = new HttpParams();

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') {
      params = params.set(key, String(value));
    }
  }

  return params;
};

export interface RepositoryFilters {
  page?: number;
  limit?: number;
  q?: string;
  language?: string;
  sort?: 'pushed' | 'stars' | 'name';
}

/**
 * The single place the UI talks to the backend.
 *
 * Components never build a URL: they call a method here. The Authorization
 * header is added once, by `AuthInterceptor`, so nothing in this file handles
 * credentials either.
 */
@Injectable({ providedIn: 'root' })
export class GithubApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  getOverview(days = 30): Observable<Overview> {
    return this.http.get<Overview>(`${this.base}/catalog/overview`, {
      params: toParams({ days }),
    });
  }

  listRepositories(filters: RepositoryFilters = {}): Observable<Paginated<Repository>> {
    return this.http.get<Paginated<Repository>>(`${this.base}/catalog/repositories`, {
      params: toParams({ ...filters }),
    });
  }

  /** Every language on the account, for the repository filter. */
  listRepositoryLanguages(): Observable<{ languages: string[] }> {
    return this.http.get<{ languages: string[] }>(`${this.base}/catalog/languages`);
  }

  listCommits(
    filters: { page?: number; limit?: number; repositoryId?: string } = {},
  ): Observable<Paginated<Commit>> {
    return this.http.get<Paginated<Commit>>(`${this.base}/catalog/commits`, {
      params: toParams({ ...filters }),
    });
  }

  listIssues(
    filters: { page?: number; limit?: number; repositoryId?: string; state?: string } = {},
  ): Observable<Paginated<Issue>> {
    return this.http.get<Paginated<Issue>>(`${this.base}/catalog/issues`, {
      params: toParams({ ...filters }),
    });
  }

  listPullRequests(
    filters: { page?: number; limit?: number; repositoryId?: string; state?: string } = {},
  ): Observable<Paginated<PullRequest>> {
    return this.http.get<Paginated<PullRequest>>(`${this.base}/catalog/pull-requests`, {
      params: toParams({ ...filters }),
    });
  }

  getSyncState(): Observable<{ states: SyncStateRow[] }> {
    return this.http.get<{ states: SyncStateRow[] }>(`${this.base}/sync/state`);
  }

  /** `full` replays every listing; the default resumes from the stored watermarks. */
  runSync(options: { full?: boolean } = {}): Observable<SyncReport> {
    return this.http.post<SyncReport>(
      `${this.base}/sync`,
      {},
      { params: toParams({ mode: options.full ? 'full' : undefined }) },
    );
  }

  getStalePullRequests(limit = 20): Observable<StalePullRequestResponse> {
    return this.http.get<StalePullRequestResponse>(`${this.base}/insights/stale-pull-requests`, {
      params: toParams({ limit }),
    });
  }

  getRepositoryInsight(repositoryId: string, refresh = false): Observable<RepositoryInsight> {
    return this.http.get<RepositoryInsight>(
      `${this.base}/insights/repositories/${encodeURIComponent(repositoryId)}`,
      { params: toParams({ refresh: refresh ? 'true' : undefined }) },
    );
  }

  listProviders(): Observable<{ providers: ProviderSummary[] }> {
    return this.http.get<{ providers: ProviderSummary[] }>(`${this.base}/github/providers`);
  }

  /** 404s unless the backend was started with `DEMO_MODE=true`. */
  getDemoSession(): Observable<DemoSession> {
    return this.http.get<DemoSession>(`${this.base}/demo/session`);
  }
}

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { DashboardComponent } from './dashboard.component';
import { GithubApiService } from '../core/github-api.service';
import { SessionService } from '../core/session.service';

const isoDay = (offset: number): string => {
  const now = new Date();
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset),
  );
  return date.toISOString().slice(0, 10);
};

const overview = {
  counts: {
    repositories: 6,
    commits: 485,
    openIssues: 9,
    openPullRequests: 7,
    stalePullRequests: 4,
  },
  languages: [{ language: 'TypeScript', repositories: 2 }],
  activity: [
    { date: isoDay(1), commits: 12 },
    { date: isoDay(3), commits: 5 },
  ],
  topRepositories: [
    { fullName: 'octo-labs/ledger-core', stars: 412, language: 'TypeScript', commits: 140 },
  ],
  lastSyncedAt: '2026-09-23T08:00:00.000Z',
};

const states = [
  { resource: 'commits', scopeId: '1', lastStatus: 'ok', hasEtag: true },
  { resource: 'commits', scopeId: '2', lastStatus: 'error', hasEtag: false },
  { resource: 'issues', scopeId: '1', lastStatus: 'not_modified', hasEtag: true },
];

describe('DashboardComponent', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let component: any;
  let api: jasmine.SpyObj<GithubApiService>;

  const build = (connected: boolean) => {
    api = jasmine.createSpyObj<GithubApiService>('GithubApiService', [
      'getOverview',
      'getSyncState',
      'runSync',
    ]);
    api.getOverview.and.returnValue(of(overview) as never);
    api.getSyncState.and.returnValue(of({ states }) as never);
    api.runSync.and.returnValue(of({ mode: 'incremental', durationMs: 120 }) as never);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideRouter([]),
        { provide: GithubApiService, useValue: api },
        {
          provide: SessionService,
          useValue: { isConnected: () => connected, username: () => 'octo-labs-demo' },
        },
      ],
    });

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  it('does not call the API when no account is connected', () => {
    build(false);

    expect(api.getOverview).not.toHaveBeenCalled();
    expect(component.loading()).toBeFalse();
  });

  it('loads the overview for a connected account', () => {
    build(true);

    expect(api.getOverview).toHaveBeenCalledWith(30);
    expect(component.overview()).toEqual(overview as never);
  });

  it('fills the days the backend reported no commits for', () => {
    build(true);

    const activity = component.activity();

    expect(activity.length).toBe(30);
    expect(component.commitsInWindow()).toBe(17);
  });

  it('collapses the pipeline state into one row per resource', () => {
    build(true);

    const rows = component.pipeline();
    const commits = rows.find((row: { resource: string }) => row.resource === 'commits');

    expect(rows.length).toBe(2);
    expect(commits.rows).toBe(2);
    expect(commits.failures).toBe(1);
    expect(commits.cached).toBe(1);
  });

  it('keeps rendering the overview when the pipeline panel fails', () => {
    build(true);
    api.getSyncState.and.returnValue(throwError(() => new Error('nope')) as never);

    component.load();

    expect(component.overview()).toEqual(overview as never);
    expect(component.syncStates()).toEqual([]);
  });

  it('shows a rate-limit specific message when a sync is throttled', () => {
    build(true);
    api.runSync.and.returnValue(throwError(() => ({ status: 429 })) as never);

    component.sync();

    expect(component.error()).toContain('rate limited');
    expect(component.syncing()).toBeFalse();
  });

  it('reloads the overview after a successful sync', () => {
    build(true);
    api.getOverview.calls.reset();

    component.sync();

    expect(api.getOverview).toHaveBeenCalled();
    expect(component.lastReport()).toBeTruthy();
  });

  it('sums up the last run in one sentence, with the quota when it is known', () => {
    build(true);
    api.runSync.and.returnValue(
      of({
        mode: 'incremental',
        durationMs: 37,
        pagesFetched: 0,
        conditionalHits: 19,
        rateLimit: { limit: 5000, remaining: 4899, resetAt: null },
      }) as never,
    );

    component.sync();

    expect(component.reportLine()).toBe(
      'Incremental sync finished in 37 ms · 0 pages fetched · 19 listings unchanged ' +
        '(304, no quota spent) · 4899 of 5000 API calls left this hour.',
    );
  });
});

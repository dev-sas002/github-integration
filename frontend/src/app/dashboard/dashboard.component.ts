import { DatePipe, DecimalPipe, NgFor, NgIf } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { GithubApiService } from '../core/github-api.service';
import { Overview, SyncReport, SyncStateRow } from '../core/api.types';
import { SessionService } from '../core/session.service';
import { BarListComponent } from '../shared/charts/bar-list.component';
import { ColumnChartComponent } from '../shared/charts/column-chart.component';
import { StatTileComponent } from '../shared/stat-tile.component';

/** Fills in the days the backend has no commits for, so the axis has no gaps. */
const denseActivity = (
  points: Array<{ date: string; commits: number }>,
  days: number,
): Array<{ date: string; commits: number }> => {
  const byDate = new Map(points.map((point) => [point.date, point.commits]));
  const dense: Array<{ date: string; commits: number }> = [];
  const today = new Date();

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset),
    );
    const key = date.toISOString().slice(0, 10);
    dense.push({ date: key, commits: byDate.get(key) ?? 0 });
  }

  return dense;
};

const RESOURCE_LABELS: Record<string, string> = {
  repositories: 'Repositories',
  commits: 'Commits',
  issues: 'Issues',
  pullRequests: 'Pull requests',
};

/**
 * The overview: what was synced, how active it is, and what the pipeline did
 * on its last run.
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css'],
  imports: [
    NgIf,
    NgFor,
    DatePipe,
    DecimalPipe,
    RouterLink,
    MatIconModule,
    StatTileComponent,
    ColumnChartComponent,
    BarListComponent,
  ],
})
export class DashboardComponent implements OnInit {
  private readonly api = inject(GithubApiService);

  readonly session = inject(SessionService);

  protected readonly ACTIVITY_DAYS = 30;

  protected readonly loading = signal(true);
  protected readonly syncing = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly overview = signal<Overview | null>(null);
  protected readonly syncStates = signal<SyncStateRow[]>([]);
  protected readonly lastReport = signal<SyncReport | null>(null);

  protected readonly activity = computed(() =>
    denseActivity(this.overview()?.activity ?? [], this.ACTIVITY_DAYS),
  );

  protected readonly languages = computed(() =>
    (this.overview()?.languages ?? []).map((slice) => ({
      label: slice.language,
      value: slice.repositories,
    })),
  );

  protected readonly commitsInWindow = computed(() =>
    this.activity().reduce((total, point) => total + point.commits, 0),
  );

  /** One row per resource family, collapsed across repositories. */
  protected readonly pipeline = computed(() => {
    const grouped = new Map<string, { rows: number; failures: number; cached: number }>();

    for (const state of this.syncStates()) {
      const entry = grouped.get(state.resource) ?? { rows: 0, failures: 0, cached: 0 };
      entry.rows += 1;
      if (state.lastStatus === 'error' || state.lastStatus === 'rate_limited') {
        entry.failures += 1;
      }
      if (state.hasEtag) {
        entry.cached += 1;
      }
      grouped.set(state.resource, entry);
    }

    return Array.from(grouped.entries()).map(([resource, entry]) => ({
      resource,
      label: RESOURCE_LABELS[resource] ?? resource,
      ...entry,
    }));
  });

  ngOnInit(): void {
    if (this.session.isConnected()) {
      this.load();
    } else {
      this.loading.set(false);
    }
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.api.getOverview(this.ACTIVITY_DAYS).subscribe({
      next: (overview) => {
        this.overview.set(overview);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not load the overview. Is the account still connected?');
        this.loading.set(false);
      },
    });

    this.api.getSyncState().subscribe({
      next: (response) => this.syncStates.set(response.states),
      // The pipeline panel is supplementary; a failure here must not blank the page.
      error: () => this.syncStates.set([]),
    });
  }

  protected sync(): void {
    this.syncing.set(true);
    this.error.set(null);

    this.api.runSync().subscribe({
      next: (report) => {
        this.lastReport.set(report);
        this.syncing.set(false);
        this.load();
      },
      error: (failure: { status?: number }) => {
        this.error.set(
          failure.status === 429
            ? 'GitHub rate limited the sync. The pipeline will resume from its watermarks on the next run.'
            : 'The sync could not be started.',
        );
        this.syncing.set(false);
      },
    });
  }
}

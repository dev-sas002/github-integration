import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StalePullRequest, StaleSeverity } from '../core/api.types';
import { GithubApiService } from '../core/github-api.service';
import { SessionService } from '../core/session.service';

/**
 * Severity is carried by an icon and a word as well as a colour, so the
 * distinction survives colour-blindness, greyscale printing and forced-colours
 * mode.
 */
const SEVERITY: Record<StaleSeverity, { label: string; icon: string }> = {
  watch: { label: 'Watch', icon: 'schedule' },
  stale: { label: 'Stale', icon: 'warning_amber' },
  abandoned: { label: 'Abandoned', icon: 'report_problem' },
};

/**
 * Stale pull-request detection.
 *
 * The rule is deliberately explainable — open, and untouched for longer than
 * the configured threshold — so the list can be acted on without anyone having
 * to trust a model.
 */
@Component({
  selector: 'app-pull-requests',
  templateUrl: './pull-requests.component.html',
  styleUrls: ['./pull-requests.component.css'],
  imports: [DatePipe, RouterLink],
})
export class PullRequestsComponent implements OnInit {
  private readonly api = inject(GithubApiService);

  readonly session = inject(SessionService);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly thresholdDays = signal(14);
  protected readonly items = signal<StalePullRequest[]>([]);

  protected readonly buckets = computed(() => {
    const items = this.items();
    return (['abandoned', 'stale', 'watch'] as StaleSeverity[])
      .map((severity) => ({
        severity,
        ...SEVERITY[severity],
        items: items.filter((item) => item.severity === severity),
      }))
      .filter((bucket) => bucket.items.length > 0);
  });

  protected readonly oldest = computed(() =>
    this.items().reduce((worst, item) => Math.max(worst, item.ageDays), 0),
  );

  ngOnInit(): void {
    if (this.session.isConnected()) {
      this.load();
    }
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.api.getStalePullRequests(50).subscribe({
      next: (response) => {
        this.thresholdDays.set(response.thresholdDays);
        this.items.set(response.items);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not load pull requests.');
        this.loading.set(false);
      },
    });
  }

  protected severityLabel(severity: StaleSeverity): string {
    return SEVERITY[severity].label;
  }
}

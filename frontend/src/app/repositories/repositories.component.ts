import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { Paginated, Repository, RepositoryInsight } from '../core/api.types';
import { GithubApiService, RepositoryFilters } from '../core/github-api.service';
import { SessionService } from '../core/session.service';

/**
 * The synced repository catalogue.
 *
 * Paging, search and sorting all happen server-side: the component asks for
 * one page at a time and never holds the whole account in memory, which is
 * the only version of this screen that survives an account with thousands of
 * repositories.
 */
@Component({
  selector: 'app-repositories',
  templateUrl: './repositories.component.html',
  styleUrls: ['./repositories.component.css'],
  imports: [FormsModule, DatePipe, DecimalPipe, RouterLink],
})
export class RepositoriesComponent implements OnInit {
  private readonly api = inject(GithubApiService);

  readonly session = inject(SessionService);

  private readonly searchInput = new Subject<string>();

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly page = signal<Paginated<Repository> | null>(null);

  protected readonly selected = signal<Repository | null>(null);
  protected readonly insight = signal<RepositoryInsight | null>(null);
  protected readonly insightLoading = signal(false);

  protected query = '';
  protected language = '';
  protected sort: NonNullable<RepositoryFilters['sort']> = 'pushed';

  /**
   * Loaded once for the whole account. Deriving it from the current page
   * meant that picking a language left only that language in the list.
   */
  protected readonly languages = signal<string[]>([]);

  protected readonly rangeLabel = computed(() => {
    const page = this.page();
    if (!page || page.total === 0) {
      return '';
    }
    const first = (page.page - 1) * page.limit + 1;
    return `${first}–${first + page.items.length - 1} of ${page.total}`;
  });

  ngOnInit(): void {
    // Typing must not fire a request per keystroke.
    this.searchInput.pipe(debounceTime(250), distinctUntilChanged()).subscribe(() => this.load(1));

    if (this.session.isConnected()) {
      this.load(1);
      this.api.listRepositoryLanguages().subscribe({
        next: (response) => this.languages.set(response.languages),
        error: () => this.languages.set([]),
      });
    }
  }

  protected onSearch(value: string): void {
    this.query = value;
    this.searchInput.next(value);
  }

  protected load(page: number): void {
    this.loading.set(true);
    this.error.set(null);

    this.api
      .listRepositories({
        page,
        limit: 10,
        q: this.query || undefined,
        language: this.language || undefined,
        sort: this.sort,
      })
      .subscribe({
        next: (result) => {
          this.page.set(result);
          this.loading.set(false);
        },
        error: () => {
          this.error.set('Could not load repositories.');
          this.loading.set(false);
        },
      });
  }

  protected select(repository: Repository): void {
    if (this.selected()?.externalId === repository.externalId) {
      this.close();
      return;
    }

    this.selected.set(repository);
    this.insight.set(null);
    this.insightLoading.set(true);

    this.api.getRepositoryInsight(repository.externalId).subscribe({
      next: (insight) => {
        this.insight.set(insight);
        this.insightLoading.set(false);
      },
      error: () => {
        this.insightLoading.set(false);
        this.error.set('Could not generate a summary for that repository.');
      },
    });
  }

  protected close(): void {
    this.selected.set(null);
    this.insight.set(null);
  }
}

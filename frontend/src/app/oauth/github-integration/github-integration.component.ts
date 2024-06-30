import { DatePipe, NgFor, NgIf, isPlatformBrowser } from '@angular/common';
import { Component, Inject, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { ProviderSummary } from '../../core/api.types';
import { GithubApiService } from '../../core/github-api.service';
import { SessionService } from '../../core/session.service';
import { GithubAuthService } from '../github-auth.service';

/**
 * Connection management: start the OAuth flow, show what is connected, and
 * revoke it.
 *
 * This is also where the OAuth callback lands — the backend redirects here
 * with either `?token=` or `?error=` — so consuming those parameters and then
 * scrubbing them from the address bar is part of the component's job.
 */
@Component({
  selector: 'app-github-integration',
  standalone: true,
  templateUrl: './github-integration.component.html',
  styleUrls: ['./github-integration.component.css'],
  imports: [NgIf, NgFor, DatePipe, MatIconModule, RouterLink],
})
export class GithubIntegrationComponent implements OnInit {
  private readonly api = inject(GithubApiService);

  private readonly githubAuth = inject(GithubAuthService);

  private readonly router = inject(Router);

  readonly session = inject(SessionService);

  protected readonly connectionDate = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly providers = signal<ProviderSummary[]>([]);
  protected readonly demoAvailable = signal(false);
  protected readonly busy = signal(false);

  private readonly browser: boolean;

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.browser = isPlatformBrowser(platformId);
  }

  ngOnInit(): void {
    // The page is prerendered at build time, where `window` does not exist
    // and a relative API URL cannot be resolved — so every browser-only
    // concern, including the network, is behind this check.
    if (!this.browser) {
      return;
    }

    this.consumeTokenFromUrl();

    this.api.listProviders().subscribe({
      next: (response) => this.providers.set(response.providers),
      error: () => this.providers.set([]),
    });

    // A 404 here is the normal answer: demo mode is off by default.
    this.api.getDemoSession().subscribe({
      next: () => this.demoAvailable.set(true),
      error: () => this.demoAvailable.set(false),
    });

    this.refreshStatus();
  }

  protected get githubConfigured(): boolean {
    return this.providers().some((provider) => provider.id === 'github' && provider.configured);
  }

  private refreshStatus(): void {
    this.githubAuth.getStatus().subscribe({
      next: (status) => this.connectionDate.set(status.connectionDate),
      // A 401 simply means "not connected yet"; never leave the UI stuck.
      error: () => this.connectionDate.set(null),
    });
  }

  private consumeTokenFromUrl(): void {
    const params = new URLSearchParams(window.location.search);

    if (params.get('error')) {
      this.errorMessage.set('Could not connect to GitHub. Please try again.');
      this.clearQueryParams();
      return;
    }

    // `URLSearchParams` decodes the value and finds the key regardless of
    // parameter order.
    const token = params.get('token');
    if (token) {
      this.session.signIn(token);
      this.clearQueryParams();
    }
  }

  private clearQueryParams(): void {
    void this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }

  protected connect(): void {
    this.errorMessage.set(null);
    this.githubAuth.connect();
  }

  /** Signs in as the seeded demo account; only offered when the API allows it. */
  protected useDemoAccount(): void {
    this.busy.set(true);

    this.api.getDemoSession().subscribe({
      next: (demo) => {
        this.session.signIn(demo.token, demo.username);
        this.busy.set(false);
        void this.router.navigate(['/dashboard']);
      },
      error: () => {
        this.errorMessage.set('The demo account is not available.');
        this.busy.set(false);
      },
    });
  }

  protected disconnect(): void {
    this.busy.set(true);
    this.errorMessage.set(null);

    this.githubAuth.removeIntegration().subscribe({
      next: () => {
        this.session.signOut();
        this.connectionDate.set(null);
        this.busy.set(false);
      },
      error: () => {
        // Keep the stored token: the backend still considers the integration
        // live, so the user can retry the removal.
        this.errorMessage.set('Could not disconnect. Please try again.');
        this.busy.set(false);
      },
    });
  }
}

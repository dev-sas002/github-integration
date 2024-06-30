import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ProviderSummary } from '../../core/api.types';
import { GithubApiService } from '../../core/github-api.service';
import { SessionService } from '../../core/session.service';
import { GithubAuthService } from '../github-auth.service';

/**
 * Connection management: start the OAuth flow, show what is connected, and
 * revoke it.
 *
 * This is also where the OAuth callback lands. The backend redirects here
 * with either `#token=…&username=…` or `?error=`, so consuming those values
 * and then scrubbing them from the address bar is part of the component's job.
 * The token arrives in the fragment because browsers never send that part of
 * a URL to a server.
 */
@Component({
  selector: 'app-github-integration',
  templateUrl: './github-integration.component.html',
  styleUrls: ['./github-integration.component.css'],
  imports: [DatePipe, RouterLink],
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

  ngOnInit(): void {
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
      next: (status) => {
        this.connectionDate.set(status.connectionDate);
        if (status.username) {
          this.session.setUsername(status.username);
        }
      },
      // A 401 simply means "not connected yet"; never leave the UI stuck.
      error: () => this.connectionDate.set(null),
    });
  }

  private consumeTokenFromUrl(): void {
    const query = new URLSearchParams(window.location.search);

    if (query.get('error')) {
      this.errorMessage.set(
        query.get('error') === 'rate_limited'
          ? 'GitHub is rate limiting this app. Wait a minute and connect again.'
          : 'Could not connect to GitHub. Please try again.',
      );
      this.clearCallbackParams();
      return;
    }

    // `URLSearchParams` decodes the values and finds the keys regardless of
    // their order.
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = fragment.get('token');
    if (token) {
      this.session.signIn(token, fragment.get('username'));
      this.clearCallbackParams();
    }
  }

  /** Navigating to the current route with no extras drops both the query and the fragment. */
  private clearCallbackParams(): void {
    void this.router.navigate([], { replaceUrl: true });
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

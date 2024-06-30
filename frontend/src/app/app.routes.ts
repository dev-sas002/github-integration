import { Routes } from '@angular/router';

/**
 * Every view is lazily loaded, so the initial bundle carries the shell and
 * nothing else. `/github-integration` is kept as an alias because it is the
 * path the backend's OAuth callback redirects to.
 */
export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'dashboard',
    title: 'Overview',
    loadComponent: () => import('./dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'repositories',
    title: 'Repositories',
    loadComponent: () =>
      import('./repositories/repositories.component').then((m) => m.RepositoriesComponent),
  },
  {
    path: 'pull-requests',
    title: 'Pull requests',
    loadComponent: () =>
      import('./pull-requests/pull-requests.component').then((m) => m.PullRequestsComponent),
  },
  {
    path: 'connection',
    title: 'Connection',
    loadComponent: () =>
      import('./oauth/github-integration/github-integration.component').then(
        (m) => m.GithubIntegrationComponent,
      ),
  },
  { path: 'github-integration', redirectTo: 'connection' },
  { path: '**', redirectTo: 'dashboard' },
];

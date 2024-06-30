import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { GithubApiService } from '../../core/github-api.service';
import { SessionService } from '../../core/session.service';
import { GithubAuthService } from '../github-auth.service';
import { GithubIntegrationComponent } from './github-integration.component';

describe('GithubIntegrationComponent', () => {
  let session: SessionService;
  let auth: jasmine.SpyObj<GithubAuthService>;
  const originalUrl = window.location.pathname + window.location.search + window.location.hash;

  const build = (url: string, status = { isConnected: false, connectionDate: null }) => {
    history.replaceState(null, '', url);

    const api = jasmine.createSpyObj<GithubApiService>('GithubApiService', [
      'listProviders',
      'getDemoSession',
    ]);
    api.listProviders.and.returnValue(of({ providers: [] }) as never);
    api.getDemoSession.and.returnValue(throwError(() => ({ status: 404 })));

    auth = jasmine.createSpyObj<GithubAuthService>('GithubAuthService', [
      'getStatus',
      'connect',
      'removeIntegration',
    ]);
    auth.getStatus.and.returnValue(of(status) as never);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [GithubIntegrationComponent],
      providers: [
        provideRouter([]),
        { provide: GithubApiService, useValue: api },
        { provide: GithubAuthService, useValue: auth },
      ],
    });

    session = TestBed.inject(SessionService);
    session.signOut();
    const fixture = TestBed.createComponent(GithubIntegrationComponent);
    fixture.detectChanges();
    return fixture;
  };

  afterEach(() => {
    session?.signOut();
    history.replaceState(null, '', originalUrl);
  });

  it('signs in with the token and account name from the callback fragment', () => {
    build('/connection#token=Bearer%20gho_token&username=fixture-dev');

    expect(session.token()).toBe('Bearer gho_token');
    expect(session.username()).toBe('fixture-dev');
  });

  it('ignores a token passed in the query string', () => {
    build('/connection?token=Bearer%20gho_token');

    expect(session.isConnected()).toBeFalse();
  });

  it('explains a rate-limited callback', () => {
    const fixture = build('/connection?error=rate_limited');

    expect(fixture.nativeElement.textContent).toContain('rate limiting');
    expect(session.isConnected()).toBeFalse();
  });

  it('fills in a missing account name from the status endpoint', () => {
    build('/connection#token=Bearer%20gho_token', {
      isConnected: true,
      connectionDate: null,
      username: 'fixture-dev',
    } as never);

    expect(session.username()).toBe('fixture-dev');
  });
});

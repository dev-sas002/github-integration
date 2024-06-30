import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { GithubApiService } from '../core/github-api.service';
import { SessionService } from '../core/session.service';
import { RepositoriesComponent } from './repositories.component';

const repository = (name: string, language: string) => ({
  externalId: name,
  name,
  fullName: `harbourlight-demo/${name}`,
  owner: 'harbourlight-demo',
  description: null,
  language,
  topics: [],
  stars: 1,
  openIssues: 0,
  pushedAt: null,
});

describe('RepositoriesComponent', () => {
  let api: jasmine.SpyObj<GithubApiService>;

  const build = () => {
    api = jasmine.createSpyObj<GithubApiService>('GithubApiService', [
      'listRepositories',
      'listRepositoryLanguages',
      'getRepositoryInsight',
    ]);
    api.listRepositories.and.returnValue(
      of({
        items: [repository('tidepool', 'Go')],
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
        hasNext: false,
      }) as never,
    );
    api.listRepositoryLanguages.and.returnValue(of({ languages: ['CSS', 'Go', 'Rust'] }));
    api.getRepositoryInsight.and.returnValue(
      of({
        repository: 'harbourlight-demo/tidepool',
        source: 'heuristic',
        headline: 'Quiet but healthy',
        summary: 'Steady commits.',
        highlights: [],
        risks: [],
        facts: {
          commitsLast30Days: 3,
          commitsLast90Days: 9,
          openIssues: 1,
          closedIssues: 2,
          openPullRequests: 0,
          mergedPullRequests: 1,
          contributors: [],
        },
      }) as never,
    );

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RepositoriesComponent],
      providers: [
        provideRouter([]),
        { provide: GithubApiService, useValue: api },
        { provide: SessionService, useValue: { isConnected: () => true } },
      ],
    });

    const fixture = TestBed.createComponent(RepositoriesComponent);
    fixture.detectChanges();
    return fixture;
  };

  it('offers every language on the account, not just those on the current page', () => {
    const fixture = build();

    const options = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('#repo-language option'),
    ).map((option) => option.textContent?.trim());

    expect(options).toEqual(['All languages', 'CSS', 'Go', 'Rust']);
  });

  it('opens the summary from a keyboard-focusable button', () => {
    const fixture = build();
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'button.name',
    )!;

    button.click();
    fixture.detectChanges();

    expect(api.getRepositoryInsight).toHaveBeenCalledOnceWith('tidepool');
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });
});

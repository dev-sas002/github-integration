import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { GithubApiService } from './github-api.service';
import { environment } from '../../environments/environment';

describe('GithubApiService', () => {
  let service: GithubApiService;
  let httpMock: HttpTestingController;
  const base = environment.apiBaseUrl;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(GithubApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('requests the overview with an explicit window', () => {
    service.getOverview(14).subscribe();

    const req = httpMock.expectOne((r) => r.url === `${base}/catalog/overview`);
    expect(req.request.params.get('days')).toBe('14');
    req.flush({});
  });

  it('omits filters that were not supplied', () => {
    service.listRepositories({ page: 2 }).subscribe();

    const req = httpMock.expectOne((r) => r.url === `${base}/catalog/repositories`);
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.has('q')).toBeFalse();
    expect(req.request.params.has('language')).toBeFalse();
    req.flush({ items: [] });
  });

  it('passes search, language and sort through when they are set', () => {
    service.listRepositories({ q: 'ledger', language: 'Go', sort: 'stars' }).subscribe();

    const req = httpMock.expectOne((r) => r.url === `${base}/catalog/repositories`);
    expect(req.request.params.get('q')).toBe('ledger');
    expect(req.request.params.get('language')).toBe('Go');
    expect(req.request.params.get('sort')).toBe('stars');
    req.flush({ items: [] });
  });

  it('drops an empty search string rather than sending a blank filter', () => {
    service.listRepositories({ q: '' }).subscribe();

    const req = httpMock.expectOne((r) => r.url === `${base}/catalog/repositories`);
    expect(req.request.params.has('q')).toBeFalse();
    req.flush({ items: [] });
  });

  it('POSTs an incremental sync by default', () => {
    service.runSync().subscribe();

    const req = httpMock.expectOne((r) => r.url === `${base}/sync`);
    expect(req.request.method).toBe('POST');
    expect(req.request.params.has('mode')).toBeFalse();
    req.flush({});
  });

  it('asks for a full resync only when told to', () => {
    service.runSync({ full: true }).subscribe();

    const req = httpMock.expectOne((r) => r.url === `${base}/sync`);
    expect(req.request.params.get('mode')).toBe('full');
    req.flush({});
  });

  it('reads the sync pipeline state', () => {
    service.getSyncState().subscribe();

    const req = httpMock.expectOne(`${base}/sync/state`);
    expect(req.request.method).toBe('GET');
    req.flush({ states: [] });
  });

  it('requests a repository summary without a refresh by default', () => {
    service.getRepositoryInsight('100001').subscribe();

    const req = httpMock.expectOne((r) => r.url === `${base}/insights/repositories/100001`);
    expect(req.request.params.has('refresh')).toBeFalse();
    req.flush({});
  });

  it('forces a regeneration when refresh is requested', () => {
    service.getRepositoryInsight('100001', true).subscribe();

    const req = httpMock.expectOne((r) => r.url === `${base}/insights/repositories/100001`);
    expect(req.request.params.get('refresh')).toBe('true');
    req.flush({});
  });

  it('escapes a repository id that would otherwise break the path', () => {
    service.getRepositoryInsight('a/b').subscribe();

    const req = httpMock.expectOne((r) => r.url === `${base}/insights/repositories/a%2Fb`);
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('caps the stale pull request list', () => {
    service.getStalePullRequests(50).subscribe();

    const req = httpMock.expectOne((r) => r.url === `${base}/insights/stale-pull-requests`);
    expect(req.request.params.get('limit')).toBe('50');
    req.flush({ thresholdDays: 14, items: [] });
  });

  it('reads the provider registry', () => {
    service.listProviders().subscribe();

    const req = httpMock.expectOne(`${base}/github/providers`);
    expect(req.request.method).toBe('GET');
    req.flush({ providers: [] });
  });

  it('surfaces the demo session 404 as an error, not a value', () => {
    let errored = false;

    service.getDemoSession().subscribe({ error: () => (errored = true) });

    httpMock
      .expectOne(`${base}/demo/session`)
      .flush({ message: 'Not found' }, { status: 404, statusText: 'Not Found' });

    expect(errored).toBeTrue();
  });
});

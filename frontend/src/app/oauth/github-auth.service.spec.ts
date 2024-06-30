import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { GithubAuthService } from './github-auth.service';
import { environment } from '../../environments/environment';

describe('GithubAuthService', () => {
  let service: GithubAuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(GithubAuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('GETs the status endpoint on the configured API url', () => {
    const payload = { isConnected: true, connectionDate: '2024-05-01T10:00:00.000Z' };
    let received: unknown;

    service.getStatus().subscribe((status) => (received = status));

    const req = httpMock.expectOne(`${environment.apiBaseUrl}/github/status`);
    expect(req.request.method).toBe('GET');
    // The interceptor owns the Authorization header; the service must not
    // set a second (differently formatted) one.
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush(payload);

    expect(received).toEqual(payload);
  });

  it('surfaces a 401 from the status endpoint as an error', () => {
    let errorStatus = 0;

    service.getStatus().subscribe({ error: (err) => (errorStatus = err.status) });

    httpMock
      .expectOne(`${environment.apiBaseUrl}/github/status`)
      .flush({ isConnected: false }, { status: 401, statusText: 'Unauthorized' });

    expect(errorStatus).toBe(401);
  });

  it('DELETEs the remove endpoint', () => {
    service.removeIntegration().subscribe();

    const req = httpMock.expectOne(`${environment.apiBaseUrl}/github/remove`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });
});

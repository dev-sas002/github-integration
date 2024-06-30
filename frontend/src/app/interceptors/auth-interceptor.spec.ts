import { TestBed } from '@angular/core/testing';
import {
  HTTP_INTERCEPTORS,
  HttpClient,
  provideHttpClient,
  withInterceptorsFromDi,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthInterceptor } from './auth-interceptor';
import { SessionService } from '../core/session.service';

describe('AuthInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let token: string | null;

  beforeEach(() => {
    token = null;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
        { provide: SessionService, useValue: { token: () => token } },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('attaches the stored Authorization header exactly once', () => {
    token = 'Bearer gho_token';
    http.get('/api/github/status').subscribe();

    const req = httpMock.expectOne('/api/github/status');
    expect(req.request.headers.get('Authorization')).toBe('Bearer gho_token');
    req.flush({});
  });

  it('leaves the request untouched when there is no session', () => {
    http.get('/api/github/status').subscribe();

    const req = httpMock.expectOne('/api/github/status');
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({});
  });
});

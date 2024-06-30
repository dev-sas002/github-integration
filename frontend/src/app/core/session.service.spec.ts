import { TestBed } from '@angular/core/testing';
import { ACCESS_TOKEN_STORAGE_KEY, SessionService } from './session.service';

describe('SessionService', () => {
  const serviceFor = (): SessionService => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [SessionService] });
    return TestBed.inject(SessionService);
  };

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('starts disconnected when nothing is stored', () => {
    const session = serviceFor();

    expect(session.isConnected()).toBeFalse();
    expect(session.token()).toBeNull();
  });

  it('restores a token that was already stored', () => {
    localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, 'Bearer gho_token');

    const session = serviceFor();

    expect(session.isConnected()).toBeTrue();
    expect(session.token()).toBe('Bearer gho_token');
  });

  it('stores the header value unchanged, without adding a second prefix', () => {
    const session = serviceFor();

    session.signIn('Bearer gho_token', 'octo');

    expect(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBe('Bearer gho_token');
    expect(session.username()).toBe('octo');
  });

  it('clears the username when signing in without one', () => {
    const session = serviceFor();
    session.signIn('Bearer a', 'octo');

    session.signIn('Bearer b');

    expect(session.username()).toBeNull();
  });

  it('records an account name learned after sign-in', () => {
    const session = serviceFor();
    session.signIn('Bearer gho_token');

    session.setUsername('fixture-dev');

    expect(session.username()).toBe('fixture-dev');
    expect(serviceFor().username()).toBe('fixture-dev');
  });

  it('forgets everything on sign out', () => {
    const session = serviceFor();
    session.signIn('Bearer gho_token', 'octo');

    session.signOut();

    expect(session.isConnected()).toBeFalse();
    expect(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBeNull();
  });
});

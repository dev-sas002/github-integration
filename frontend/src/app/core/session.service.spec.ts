import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { ACCESS_TOKEN_STORAGE_KEY, SessionService } from './session.service';

describe('SessionService', () => {
  const serviceFor = (platformId: string): SessionService => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [SessionService, { provide: PLATFORM_ID, useValue: platformId }],
    });
    return TestBed.inject(SessionService);
  };

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('starts disconnected when nothing is stored', () => {
    const session = serviceFor('browser');

    expect(session.isConnected()).toBeFalse();
    expect(session.token()).toBeNull();
  });

  it('restores a token that was already stored', () => {
    localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, 'Bearer gho_token');

    const session = serviceFor('browser');

    expect(session.isConnected()).toBeTrue();
    expect(session.token()).toBe('Bearer gho_token');
  });

  it('stores the header value unchanged, without adding a second prefix', () => {
    const session = serviceFor('browser');

    session.signIn('Bearer gho_token', 'octo');

    expect(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBe('Bearer gho_token');
    expect(session.username()).toBe('octo');
  });

  it('clears the username when signing in without one', () => {
    const session = serviceFor('browser');
    session.signIn('Bearer a', 'octo');

    session.signIn('Bearer b');

    expect(session.username()).toBeNull();
  });

  it('forgets everything on sign out', () => {
    const session = serviceFor('browser');
    session.signIn('Bearer gho_token', 'octo');

    session.signOut();

    expect(session.isConnected()).toBeFalse();
    expect(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('never touches localStorage on the server platform', () => {
    localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, 'Bearer gho_token');

    const session = serviceFor('server');
    session.signIn('Bearer other', 'octo');

    expect(session.token()).toBe('Bearer other');
    expect(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBe('Bearer gho_token');
  });
});

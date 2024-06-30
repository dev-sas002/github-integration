import { Injectable, computed, signal } from '@angular/core';

/** Key the OAuth callback's token is persisted under. */
export const ACCESS_TOKEN_STORAGE_KEY = 'accessToken';

const USERNAME_STORAGE_KEY = 'accountUsername';

/**
 * The signed-in session, as reactive state.
 *
 * The token lives in `localStorage` (it is what the backend hands back at the
 * end of the OAuth redirect), but nothing reads that key directly: views read
 * the signals, so a connect or disconnect updates every view at once instead
 * of leaving stale chrome behind.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly tokenSignal = signal<string | null>(null);

  private readonly usernameSignal = signal<string | null>(null);

  readonly token = this.tokenSignal.asReadonly();

  readonly username = this.usernameSignal.asReadonly();

  readonly isConnected = computed(() => this.tokenSignal() !== null);

  constructor() {
    this.tokenSignal.set(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY));
    this.usernameSignal.set(localStorage.getItem(USERNAME_STORAGE_KEY));
  }

  /** Stores the header value exactly as received — it already carries `Bearer `. */
  signIn(token: string, username?: string | null): void {
    this.tokenSignal.set(token);
    this.usernameSignal.set(username ?? null);

    localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
    if (username) {
      localStorage.setItem(USERNAME_STORAGE_KEY, username);
    } else {
      localStorage.removeItem(USERNAME_STORAGE_KEY);
    }
  }

  /** Fills in the account name when the session started without one. */
  setUsername(username: string): void {
    this.usernameSignal.set(username);
    localStorage.setItem(USERNAME_STORAGE_KEY, username);
  }

  signOut(): void {
    this.tokenSignal.set(null);
    this.usernameSignal.set(null);
    localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    localStorage.removeItem(USERNAME_STORAGE_KEY);
  }
}

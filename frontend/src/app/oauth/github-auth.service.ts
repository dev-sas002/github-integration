import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface GithubStatus {
  isConnected: boolean;
  connectionDate: string | null;
  username?: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class GithubAuthService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiBaseUrl}/github`;

  connect(): void {
    // Full page navigation: the backend answers with a 302 to GitHub.
    window.location.href = `${this.apiUrl}/connect`;
  }

  // The Authorization header is attached by AuthInterceptor, so it is not
  // set here as well (setting it twice previously double-prefixed `Bearer`).
  getStatus(): Observable<GithubStatus> {
    return this.http.get<GithubStatus>(`${this.apiUrl}/status`);
  }

  removeIntegration(): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/remove`);
  }
}

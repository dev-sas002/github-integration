import { HttpErrorResponse, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { tap } from 'rxjs';
import { SessionService } from '../core/session.service';

/**
 * Attaches the stored Authorization header to outgoing requests, and drops
 * the session when the API rejects it.
 *
 * It is the only place the header is set. Services used to add their own as
 * well, which produced `Bearer Bearer <token>` and a 401 on every
 * authenticated call.
 */
@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private readonly session = inject(SessionService);

  intercept(req: HttpRequest<unknown>, next: HttpHandler) {
    const token = this.session.token();

    if (!token) {
      return next.handle(req);
    }

    // The stored value already carries its `Bearer ` prefix; nothing is added.
    return next.handle(req.clone({ headers: req.headers.set('Authorization', token) })).pipe(
      tap({
        error: (error: unknown) => {
          // A 401 for a token we sent means the backend no longer knows it
          // (disconnected elsewhere, or the database was reset). Keeping it
          // would leave every view failing with no way back to "Connect".
          if (
            error instanceof HttpErrorResponse &&
            error.status === 401 &&
            this.session.token() === token
          ) {
            this.session.signOut();
          }
        },
      }),
    );
  }
}
